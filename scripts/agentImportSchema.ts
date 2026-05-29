import {
  agentColorPresetSchema,
  agentRuntimeSchema,
  allowedEffortsForRuntime,
} from '../packages/shared/src'

function effortEnumForRuntime(runtime: 'claude' | 'codex'): Array<string | null> {
  return [...allowedEffortsForRuntime(runtime), null]
}

export function buildAgentImportSchema(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://roundtable.local/schemas/agent-import.schema.json',
    title: 'Roundtable Agent Import',
    description: 'Import one Roundtable agent or an array of up to 50 agents.',
    oneOf: [
      { $ref: '#/$defs/agentImport' },
      {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: { $ref: '#/$defs/agentImport' },
      },
    ],
    $defs: {
      agentImport: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'runtime'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            description: 'Display name for the agent.',
          },
          runtime: {
            type: 'string',
            enum: agentRuntimeSchema.options,
            description: 'Agent runtime used when this agent participates.',
          },
          role_description: {
            type: 'string',
            default: '',
            description: 'Short role shown in the agent catalogue.',
          },
          instructions: {
            type: 'string',
            default: '',
            description: 'Agent instructions passed to the runtime.',
          },
          model: {
            type: ['string', 'null'],
            minLength: 1,
            description: 'Optional model override. Omit or use null for the runtime default.',
          },
          effort: {
            type: ['string', 'null'],
            description:
              'Optional reasoning effort. Allowed values depend on runtime: Claude supports low, medium, high, xhigh, and max. Codex supports low, medium, high, and xhigh. Omit or use null for the runtime default.',
          },
          color: {
            type: 'string',
            enum: agentColorPresetSchema.options,
            default: 'blue',
          },
          logo_url: {
            type: ['string', 'null'],
            format: 'uri',
            description: 'Optional absolute URL for an agent logo.',
          },
        },
        allOf: [
          {
            if: {
              properties: { runtime: { const: 'codex' } },
              required: ['runtime'],
            },
            then: {
              properties: {
                effort: {
                  enum: effortEnumForRuntime('codex'),
                },
              },
            },
          },
          {
            if: {
              properties: { runtime: { const: 'claude' } },
              required: ['runtime'],
            },
            then: {
              properties: {
                effort: {
                  enum: effortEnumForRuntime('claude'),
                },
              },
            },
          },
        ],
      },
    },
  }
}

export function renderAgentImportSchema(): string {
  return `${JSON.stringify(buildAgentImportSchema(), null, 2)}\n`
}
