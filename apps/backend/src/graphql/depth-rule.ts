import {
  GraphQLError,
  Kind,
  type ASTVisitor,
  type SelectionSetNode,
  type ValidationContext,
} from 'graphql';

/** Bounded physical AST size plus memoized depth through named fragments. */
export function depthLimitEight(context: ValidationContext): ASTVisitor {
  const fragmentDepths = new Map<string, number>();
  const visiting = new Set<string>();
  let fieldCount = 0;
  let aliasCount = 0;

  function maxDepth(set: SelectionSetNode): number {
    let max = 0;
    for (const selection of set.selections) {
      if (selection.kind === Kind.FIELD) {
        max = Math.max(
          max,
          1 + (selection.selectionSet ? maxDepth(selection.selectionSet) : 0),
        );
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        max = Math.max(max, maxDepth(selection.selectionSet));
      } else {
        const name = selection.name.value;
        let depth = fragmentDepths.get(name);
        if (depth === undefined && !visiting.has(name)) {
          visiting.add(name);
          const fragment = context.getFragment(name);
          depth = fragment ? maxDepth(fragment.selectionSet) : 0;
          visiting.delete(name);
          fragmentDepths.set(name, depth);
        }
        max = Math.max(max, depth ?? 0);
      }
    }
    return max;
  }

  return {
    Field(node) {
      fieldCount++;
      if (fieldCount === 1001) {
        context.reportError(
          new GraphQLError('Query exceeds maximum field count of 1000', {
            nodes: [node],
            extensions: { code: 'BAD_USER_INPUT' },
          }),
        );
      }
      if (node.alias && ++aliasCount === 201) {
        context.reportError(
          new GraphQLError('Query exceeds maximum alias count of 200', {
            nodes: [node],
            extensions: { code: 'BAD_USER_INPUT' },
          }),
        );
      }
    },
    OperationDefinition(node) {
      if (maxDepth(node.selectionSet) > 8) {
        context.reportError(
          new GraphQLError('Query exceeds maximum depth of 8', {
            nodes: [node],
            extensions: { code: 'BAD_USER_INPUT' },
          }),
        );
      }
    },
  };
}
