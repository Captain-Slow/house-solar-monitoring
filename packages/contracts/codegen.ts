import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "../../apps/backend/schema.gql",
  documents: "src/operations/*.graphql",
  generates: {
    "src/generated/graphql.ts": {
      plugins: ["typescript", "typescript-operations", "typed-document-node"],
      config: { documentMode: "documentNode", avoidOptionals: true },
    },
  },
};

export default config;
