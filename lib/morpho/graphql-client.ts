/**
 * GraphQL Client for Morpho API
 * Uses graphql-request with SDK-generated types for type safety
 */
import { request, type RequestDocument } from 'graphql-request';
import { MORPHO_GRAPHQL_ENDPOINT } from '@/lib/constants';

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

/**
 * Type-safe GraphQL client wrapper
 */
class MorphoGraphQLClient {
  private endpoint: string;

  constructor(endpoint: string = MORPHO_GRAPHQL_ENDPOINT) {
    this.endpoint = endpoint;
  }

  async request<T = unknown>(
    document: RequestDocument,
    variables?: Record<string, unknown>
  ): Promise<T> {
    try {
      const data = await request<T>(this.endpoint, document, variables);
      return data;
    } catch (error: unknown) {
      // Enhanced error handling
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

// Singleton instance
export const morphoGraphQLClient = new MorphoGraphQLClient();

