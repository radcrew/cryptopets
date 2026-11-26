import type { Pet } from '@shared/core';

export type ArtPet = Pick<Pet, 'id' | 'chain' | 'assetKey' | 'dna' | 'name'>;

/**
 * Art identity for a pet that is not in the player's own list: a rival's roster pet or a drawn
 * fighter. Team battles are EVM only (D6), and an EVM pet's art is addressed by its numeric id,
 * so the id and DNA the backend serves are enough.
 */
export const teamPetArt = (petId: string, dna: string | bigint, name: string): ArtPet => ({
    id: petId,
    chain: 'evm',
    dna: BigInt(dna),
    name,
});
