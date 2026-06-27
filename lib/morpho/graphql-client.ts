/**
 * GraphQL Client for Morpho API
 * Uses graphql-request with SDK-generated types for type safety
 */
import { GraphQLClient, type RequestDocument } from 'graphql-request';
import { print, type DocumentNode } from 'graphql';
import { MORPHO_GRAPHQL_ENDPOINT } from '@/lib/constants';
import { logger } from '@/lib/utils/logger';

type GraphQLError = {
  message: string;
  path?: string[];
};

type GraphQLResponseError = {
  response?: {
    errors?: GraphQLError[];
  };
  message?: string;
};

type MorphoDeprecationWarning = {
  type?: string;
  field?: string;
  path?: string;
  message?: string;
  removalAt?: string;
};

function requestDocumentToString(document: RequestDocument): string {
  return typeof document === 'string' ? document : print(document as DocumentNode);
}

/**
 * Type-safe GraphQL client wrapper
 */
class MorphoGraphQLClient {
  private client: GraphQLClient;

  constructor(endpoint: string = MORPHO_GRAPHQL_ENDPOINT) {
    this.client = new GraphQLClient(endpoint);
  }

  async request<T = unknown>(
    document: RequestDocument,
    variables?: Record<string, unknown>
  ): Promise<T> {
    try {
      const { data, extensions } = await this.client.rawRequest<T>(
        requestDocumentToString(document),
        variables
      );
      const warnings = (extensions as { warnings?: MorphoDeprecationWarning[] } | undefined)
        ?.warnings;
      if (warnings?.length) {
        logger.warn('Morpho GraphQL deprecation warnings', {
          count: warnings.length,
          warnings: warnings.map((w) => ({
            field: w.field,
            path: w.path,
            message: w.message,
            removalAt: w.removalAt,
          })),
        });
      }
      return data;
    } catch (error: unknown) {
      const graphqlError = error as GraphQLResponseError;
      if (graphqlError.response?.errors) {
        const errors = graphqlError.response.errors;
        const errorMessages = errors.map((e: GraphQLError) => e.message).join(', ');
        throw new Error(`GraphQL Error: ${errorMessages}`);
      }
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Unknown GraphQL error occurred');
    }
  }
}

export const morphoGraphQLClient = new MorphoGraphQLClient();
