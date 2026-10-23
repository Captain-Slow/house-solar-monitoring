import { Module, type DynamicModule } from '@nestjs/common';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import { depthLimitEight } from './depth-rule.js';
import { GraphQLDateTime, GraphQLLocalDate } from 'graphql-scalars';
import type { AuthRequest } from '../auth/token.middleware.js';
import { ApiResolver } from './api.resolver.js';
import { DecimalScalar } from './scalars/decimal.scalar.js';
import { AccountingResolver } from './accounting.resolver.js';
import { TariffResolver } from './tariff.resolver.js';
import { TotalsService } from '../accounting/totals.service.js';
import { SeriesService } from '../accounting/series.service.js';
import { ReconciliationService } from '../reconciliation/reconciliation.service.js';

/** Scalar registration without a Phase-2 LocalDate field. */
export class LocalDateValue {}

@Module({})
export class GraphqlApiModule {
  static forRoot(schemaFile: string | boolean): DynamicModule {
    return {
      module: GraphqlApiModule,
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          autoSchemaFile: schemaFile,
          buildSchemaOptions: {
            scalarsMap: [{ type: LocalDateValue, scalar: GraphQLLocalDate }],
          },
          sortSchema: true,
          includeStacktraceInErrorResponses: false,
          introspection: true,
          playground: false,
          csrfPrevention: false,
          plugins: [ApolloServerPluginLandingPageDisabled()],
          maxRecursiveSelections: 10_000,
          validationRules: [depthLimitEight],
          resolvers: { DateTime: GraphQLDateTime, LocalDate: GraphQLLocalDate },
          context: ({ req }: { req: AuthRequest }) => ({
            req,
            principal: req.principal,
          }),
          formatError: (formattedError) => ({
            message:
              formattedError.extensions?.code === 'INTERNAL_SERVER_ERROR'
                ? 'Internal server error'
                : formattedError.message,
            locations: formattedError.locations,
            path: formattedError.path,
            extensions: {
              code:
                formattedError.extensions?.validationErrorCode ===
                'MAX_RECURSIVE_SELECTIONS_EXCEEDED'
                  ? 'BAD_USER_INPUT'
                  : (formattedError.extensions?.code ??
                    'INTERNAL_SERVER_ERROR'),
              ...(Array.isArray(formattedError.extensions?.issues)
                ? { issues: formattedError.extensions.issues }
                : {}),
            },
          }),
        }),
      ],
      providers: [
        ApiResolver,
        AccountingResolver,
        TariffResolver,
        TotalsService,
        SeriesService,
        ReconciliationService,
        DecimalScalar,
      ],
    };
  }
}
