import { useQueries } from '@tanstack/react-query';
import { useApiClient } from '../../contexts/ApiClientContext';
import type { PetChain } from '../../types/pet';

const PET_NAME_QUERY = `
    query PetName($chain: String!, $id: String!) {
        pet(chain: $chain, id: $id) { id name level }
    }
`;

interface PetNameDto {
    id: string;
    name: string;
    level: number;
}

interface GraphQLResponse {
    data?: { pet: PetNameDto | null };
    errors?: { message: string }[];
}

/**
 * Names for a handful of pets by id, such as the rival team a battle has just revealed. One
 * `pet` lookup per id, under the same `['pet', baseURL, chain, id]` key as `useSpousePet`, so
 * the two share their cache. An id still loading, or unknown, is absent from the map.
 */
export const usePetNames = (chain: PetChain | null, ids: readonly string[]): ReadonlyMap<string, string> => {
    const apiClient = useApiClient();
    const baseURL = apiClient.defaults.baseURL ?? '';
    const results = useQueries({
        queries: ids.map((id) => ({
            queryKey: ['pet', baseURL, chain, id],
            enabled: Boolean(chain && id && id !== '0'),
            queryFn: async (): Promise<PetNameDto | null> => {
                const res = await apiClient.post<GraphQLResponse>('/graphql', {
                    query: PET_NAME_QUERY,
                    variables: { chain, id },
                });
                if (res.data.errors?.length) {
                    throw new Error(res.data.errors.map((e) => e.message).join('; '));
                }
                return res.data.data?.pet ?? null;
            },
            staleTime: 60_000,
        })),
    });
    const names = new Map<string, string>();
    results.forEach((result, i) => {
        if (result.data?.name) names.set(ids[i]!, result.data.name);
    });
    return names;
};
