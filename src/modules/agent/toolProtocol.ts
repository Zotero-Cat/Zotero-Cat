import { isRecord } from "../../utils/text";

export type ToolJSONType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "integer"
  | "boolean";

export interface ToolJSONSchema {
  type?: ToolJSONType | ToolJSONType[];
  description?: string;
  properties?: Record<string, ToolJSONSchema>;
  required?: string[];
  items?: ToolJSONSchema;
  enum?: unknown[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  type: string;
  aliases: string[];
  readOnly: boolean;
  description?: string;
  inputSchema?: ToolJSONSchema;
  outputSchema?: ToolJSONSchema;
}

export interface ToolValidationIssue {
  path: string;
  message: string;
}

export interface ToolValidationResult {
  input: Record<string, unknown>;
  issues: ToolValidationIssue[];
}

export function validateToolInput(
  input: Record<string, unknown>,
  schema?: ToolJSONSchema,
): ToolValidationResult {
  if (!schema) {
    return { input, issues: [] };
  }
  if (!schema.properties && !schema.required?.length) {
    return { input, issues: [] };
  }
  const normalized: Record<string, unknown> = {};
  const issues: ToolValidationIssue[] = [];
  const properties = schema.properties || {};
  const required = new Set(schema.required || []);

  for (const key of Object.keys(properties)) {
    if (!(key in input)) {
      if (required.has(key)) {
        issues.push({
          path: key,
          message: "is required",
        });
      }
      continue;
    }
    const result = normalizeValue(input[key], properties[key], key);
    normalized[key] = result.value;
    issues.push(...result.issues);
  }

  for (const [key, value] of Object.entries(input)) {
    if (key in properties) {
      continue;
    }
    if (schema.additionalProperties === false) {
      issues.push({
        path: key,
        message: "is not allowed",
      });
      continue;
    }
    normalized[key] = value;
  }

  return { input: normalized, issues };
}

export function formatToolValidationIssues(
  issues: ToolValidationIssue[],
): string {
  return issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
}

export function toOpenAIToolSpec(definition: ToolDefinition) {
  return {
    type: "function" as const,
    function: {
      name: definition.type,
      description: definition.description || definition.type,
      parameters: definition.inputSchema || {
        type: "object",
        properties: {},
        additionalProperties: true,
      },
      strict: false,
    },
  };
}

export function toMCPToolSpec(definition: ToolDefinition) {
  return {
    name: definition.type,
    description: definition.description || definition.type,
    inputSchema: definition.inputSchema || {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
    ...(definition.outputSchema
      ? { outputSchema: definition.outputSchema }
      : {}),
  };
}

function normalizeValue(
  value: unknown,
  schema: ToolJSONSchema,
  path: string,
): { value: unknown; issues: ToolValidationIssue[] } {
  const issues: ToolValidationIssue[] = [];
  const expectedTypes = normalizeTypes(schema.type);
  const coerced = coerceValue(value, expectedTypes);
  if (expectedTypes.length && !matchesAnyType(coerced, expectedTypes)) {
    issues.push({
      path,
      message: `must be ${expectedTypes.join(" or ")}`,
    });
  }
  if (schema.enum && !schema.enum.some((entry) => entry === coerced)) {
    issues.push({
      path,
      message: `must be one of ${schema.enum.map(String).join(", ")}`,
    });
  }
  if (isRecord(coerced) && schema.properties) {
    const nested = validateToolInput(coerced, schema);
    return {
      value: nested.input,
      issues: issues.concat(
        nested.issues.map((issue) => ({
          path: `${path}.${issue.path}`,
          message: issue.message,
        })),
      ),
    };
  }
  if (Array.isArray(coerced) && schema.items) {
    const values: unknown[] = [];
    coerced.forEach((entry, index) => {
      const nested = normalizeValue(entry, schema.items!, `${path}.${index}`);
      values.push(nested.value);
      issues.push(...nested.issues);
    });
    return { value: values, issues };
  }
  return { value: coerced, issues };
}

function normalizeTypes(
  type: ToolJSONSchema["type"] | undefined,
): ToolJSONType[] {
  if (!type) {
    return [];
  }
  return Array.isArray(type) ? type : [type];
}

function coerceValue(value: unknown, expectedTypes: ToolJSONType[]): unknown {
  if (
    typeof value === "string" &&
    expectedTypes.includes("integer") &&
    /^-?\d+$/.test(value.trim())
  ) {
    return Number(value.trim());
  }
  if (
    typeof value === "string" &&
    expectedTypes.includes("number") &&
    /^-?(?:\d+|\d*\.\d+)$/.test(value.trim())
  ) {
    return Number(value.trim());
  }
  if (typeof value === "string" && expectedTypes.includes("boolean")) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return value;
}

function matchesAnyType(
  value: unknown,
  expectedTypes: ToolJSONType[],
): boolean {
  return expectedTypes.some((type) => matchesType(value, type));
}

function matchesType(value: unknown, type: ToolJSONType): boolean {
  if (type === "integer") {
    return typeof value === "number" && Number.isInteger(value);
  }
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (type === "array") {
    return Array.isArray(value);
  }
  if (type === "object") {
    return isRecord(value);
  }
  return typeof value === type;
}
