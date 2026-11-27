// Auth callback — consumed by app bootstrap code (e.g. frontend/src/config.ts).
export { setTokenSuccessCallback } from './chains/ethereum/useVerifySignature';
// Low-level EVM read hook — consumed by mobile until it migrates to usePetList.
export { usePetsContract } from './chains/ethereum/usePetsContract';
// v2 fee schedule readers — EVM reads GameConfig, Solana reads GlobalState PDA.
// useFees is the unified chain-neutral interface; useEvmFees/useSolanaFees are low-level.
export { useFees, type UnifiedFees } from './session/useFees';
export { useEvmFees, type EvmFees } from './chains/ethereum/useEvmFees';
export { useSolanaFees, type SolanaFees } from './chains/solana/useSolanaFees';
// Manual recovery for an interrupted async breed (settle / cancel a pending request).
export { usePendingBreed, type PendingBreed } from './chains/ethereum/usePendingBreed';
export { useBreedRelationCheck, type BreedRelationCheck } from './chains/ethereum/useBreedRelationCheck';
// Solana pending VRF requests — auto-resumes on next action; cancel available after randomness expiry.
export { usePendingSolanaBreed, type PendingSolanaBreed } from './chains/solana/usePendingSolanaBreed';
// Solana NFT metadata sync — re-publishes on-chain state to Metaplex Core attributes. No-op on EVM.
export { useSyncMetadata, type UseSyncMetadataResult } from './pets/useSyncMetadata';
// Solana stud fee earnings: balance query + withdraw_stud_fees action.
export { useStudFees, type UseStudFeesResult } from './marriage/useStudFees';
// v2.1 marriage: write actions + per-pet marriage state (EVM + Solana).
export { useMarriage, type MarriageAction } from './marriage/useMarriage';
export { useMarriageInfo, type MarriageInfo } from './marriage/useMarriageInfo';

export { useActiveChain, type ActiveChain } from './session/useActiveChain';
export { useChainCapabilities, type ChainContext } from './session/useChainCapabilities';
export type { TxLifecycle, TxPhase, ChainCapabilities } from './adapters/types';
export { usePetList, type PetListResult } from './pets/usePetList';
// Per-pet cooldown readiness + live countdown labels. Platform-neutral: React state and
// the shared readiness helpers only, so the mobile pet list can use it unchanged.
export { usePetCooldowns, type PetCooldowns, type PetCooldownStatus } from './pets/usePetCooldowns';
// Backend battle progression. usePetList already applies it to a player's own pets;
// exported for anything reading pets from the chain by another route.
export {
    battleProgressQueryKey,
    battleProgressQueryPrefix,
    useBattleProgress,
    mergeBattleProgress,
} from './battle/useBattleProgress';
export {
    useCreatePet,
    type CreatePetArgs,
    type PetMutationOptions,
    type PetMutationResult,
} from './pets/useCreatePet';
export { useLevelUpPet, type LevelUpPetArgs } from './pets/useLevelUpPet';
export { useTrainPet, type TrainPetArgs } from './pets/useTrainPet';
export { useRenamePet, type RenamePetArgs } from './pets/useRenamePet';
export {
    describeBattleStage,
    useBattlePets,
    type BattlePetsArgs,
    type UseBattlePetsOptions,
} from './battle/useBattlePets';
export {
    useBreedPets,
    type BreedPetsArgs,
    type UseBreedPetsOptions,
} from './pets/useBreedPets';
export { useTransferPet, type TransferPetArgs } from './pets/useTransferPet';
export {
    describeNoOpponents,
    type OpponentsEmptyReason,
    useOpponents,
    type UseOpponentsOptions,
} from './battle/useOpponents';
export { useSearchPets, type UseSearchPetsOptions, type SearchPetsResult } from './pets/useSearchPets';
export { useAllPets, type UseAllPetsOptions } from './pets/useAllPets';
export {
    useSpousePet,
    type UseSpousePetOptions,
    type SpousePetResult,
} from './pets/useSpousePet';
export { usePetNames } from './pets/usePetNames';
export { useIncomingProposals, type IncomingProposal } from './marriage/useIncomingProposals';
export { useWinEstimate, type WinEstimateResult } from './battle/useWinEstimate';
// Leaderboards. Ranked server-side over the merged battle record, so a page arrives
// already ordered and `rank` is absolute rather than per-page.
export {
    useLeaderboard,
    type LeaderboardEntry,
    type UseLeaderboardOptions,
    type UseLeaderboardResult,
} from './leaderboard/useLeaderboard';
export {
    usePlayerLeaderboard,
    type PlayerLeaderboardEntry,
    type UsePlayerLeaderboardOptions,
    type UsePlayerLeaderboardResult,
} from './leaderboard/usePlayerLeaderboard';
export { usePlayerRank, type UsePlayerRankResult } from './leaderboard/usePlayerRank';
// Private chat (roadmap §2 v1). Access is decided server-side from live marriage state;
// these hooks render what they are given and never gate anything themselves.
export {
    useChatThreads,
    chatThreadsQueryKey,
    type ChatThread,
    type ChatThreadPets,
    type UseChatThreadsResult,
} from './chat/useChatThreads';
export {
    useChatMessages,
    chatMessagesQueryKey,
    type ChatMessageReaction,
    type ChatMessage,
    type UseChatMessagesOptions,
    type UseChatMessagesResult,
} from './chat/useChatMessages';
export {
    useChatThreadSocket,
    type ChatThreadNotification,
    type UseChatThreadSocketOptions,
} from './chat/useChatThreadSocket';
export { CHAT_REACTIONS, isChatReaction, type ChatReaction } from './chat/reactions';
export {
    useBattleDialogue,
    type UseBattleDialogueOptions,
    type DialogueTurn,
    type DialoguePetInput,
    type DialogueSpeaker,
    type DialoguePhase,
} from './battle/useBattleDialogue';
export { useBattleTaunts, type GenerateTauntsVars } from './battle/useBattleTaunts';
// Holds the verdict a resolved receipt reports, for whatever renders the result screen.
export { useBattleOutcome, type UseBattleOutcome } from './battle/useBattleOutcome';
// Strike-by-strike playback of a verified receipt's replay log. Returns percentages and
// strings rather than anything drawable, so the web and mobile battle scenes share it.
export {
    useLiveBattleAnimation,
    describeMechanicalLogEntry,
    type LiveBattleAnimationState,
} from './battle/useLiveBattleAnimation';
export { useCreateBattleRoom, type CreateRoomVars } from './battle/useCreateBattleRoom';
// Backend-authoritative battles (docs/battle-protocol.md §D, §E, §J).
export { BATTLE_CONFIG_QUERY_KEY, useBattleConfig, type BattleConfig } from './battle/useBattleConfig';
export { useBattleMode, type BattleMode, type BattleModeState } from './battle/useBattleMode';
export {
    type BattleSession,
    signIntentWithSession,
    useBattleSession,
} from './battle/useBattleSession';
export {
    useSubmitBattleIntent,
    type AcceptedBattle,
    type SubmitBattleIntentVars,
} from './battle/useSubmitBattleIntent';
export {
    useDefenseAuthorization,
    type GrantDefenseVars,
} from './battle/useDefenseAuthorization';
export {
    type ConsentStatus,
    defenseAuthorizationsQueryKey,
    type DefenseAuthorizationSummary,
    useDefenseAuthorizations,
} from './battle/useDefenseAuthorizations';
export {
    battleStateQueryKey,
    useBackendBattle,
    useStoredBattleEvidence,
    type BattleStateSummary,
    type UseBackendBattleOptions,
} from './battle/useBackendBattle';
export {
    useBattleRoomSocket,
    type BattleRoomNotification,
    type UseBattleRoomSocketOptions,
} from './battle/useBattleRoomSocket';
// Team battles (docs/plan-team-battles-3v3.md). EVM only for now: they ship on Base first.
export {
    defensePlanQueryKey,
    type LiveDefensePlan,
    type PlanRosterEntry,
    type SaveDefensePlanVars,
    useDefensePlan,
} from './battle/useDefensePlan';
export { type TeamOpponent, useTeamOpponents } from './battle/useTeamOpponents';
export { type SubmitTeamChallengeVars, useSubmitTeamChallenge } from './battle/useSubmitTeamChallenge';
export { type TeamBattleResult, useTeamBattleResult } from './battle/useTeamBattleResult';
export {
    useVerifiedBattleReceipt,
    verifiedReceiptQueryKey,
    type VerifiedBattleReceipt,
} from './battle/useVerifiedBattleReceipt';
export { usePetError, type PetError } from './tx/usePetError';
export { useTxError, type TxError } from './tx/useTxError';

// Inventory (roadmap §4). Reads are GraphQL; useUseItem is REST, because spending a
// consumable is settled by the backend's wallet rather than signed by the player.
// Equipping is not here: it is a chain write and lives on the inventory adapter.
export {
    useInventory,
    inventoryQueryKey,
    type UseInventoryOptions,
    type UseInventoryResult,
} from './inventory/useInventory';
export {
    usePetEquipment,
    petEquipmentQueryKey,
    type UsePetEquipmentOptions,
    type UsePetEquipmentResult,
} from './inventory/usePetEquipment';
export {
    useSpendItem,
    type SpendItemArgs,
    type SpendItemResult,
    type UseSpendItemResult,
} from './inventory/useSpendItem';
// Equipping is a chain write the player signs, so it goes through its own adapter rather
// than ChainAdapter: AGENTS.md forbids growing that interface, and §4 names this case.
export { useEquipItem, type UseEquipItemOptions, type UseEquipItemResult } from './inventory/useEquipItem';
// Earned but unminted items, plus the claim that mints them. Separate from the bag: an
// entitlement is a promise of an item, and nothing on chain reflects it until it is claimed.
export {
    usePendingItems,
    pendingItemsQueryKey,
    type PendingItem,
    type UsePendingItemsResult,
} from './inventory/usePendingItems';
export {
    usePetEquipmentForPets,
    petEquipmentForPetsQueryKey,
    petEquipmentForPetsQueryPrefix,
    type UsePetEquipmentForPetsOptions,
    type UsePetEquipmentForPetsResult,
} from './inventory/usePetEquipmentForPets';
export { useInventoryAdapter } from './adapters/useInventoryAdapter';
export type { EquipArgs, InventoryAdapter, UnequipArgs } from './adapters/inventoryTypes';
export {
    describeItemEffect,
    explainItem,
    itemStats,
    ITEM_CATEGORIES,
    parseItemEffect,
    SLOT,
    SLOT_NAMES,
    type EquippedItem,
    type InventoryEntry,
    type ItemCategory,
    type ItemDefinition,
    type ItemEffect,
    type ItemStat,
    type SlotName,
    type StatBonus,
} from '../types/item';
