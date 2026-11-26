package combat

import "fmt"

// VerifyTeam is Verify for a three-on-three team battle (docs/battle-protocol.md §F, "Team
// battles"): the fight and all six fighters' progression, recomputed from the frozen inputs
// alone. The same contract as Verify: release safety, not a trust boundary, and no
// database, network or clock.

// TeamPet is one team-battle pet: its frozen inputs and its placement.
type TeamPet struct {
	Pet    PetInputs
	Col    uint8
	Row    uint8
	Tactic Tactic
}

// TeamVerifyRequest is everything needed to recompute one team battle. Roster is the
// defender's three pets, the plan's roster, in slot order.
type TeamVerifyRequest struct {
	Attackers   []TeamPet
	Roster      []TeamPet
	Seed        [32]byte
	SkillConfig SkillConfig
	TeamConfig  TeamConfig
	MaxLevel    uint16
}

// TeamVerifyResult is Go's recomputation. As with VerifyResult, the log travels back as
// structured data for the caller to hash with the one canonical encoder.
type TeamVerifyResult struct {
	Battle TeamResult
	// Progression covers the six fighters: attackers, then defenders, each by slot.
	Progression []PetProgression
}

// VerifyTeam runs the fight and the progression.
//
// Every pet fights neutral (Melee, no temperament, speed unused), which is what ruleset
// layout 3 means: it carries no Attributes 2.0 data. The TypeScript side applies the same
// rule in one place, protocol's replayTeamBattle.
func VerifyTeam(req TeamVerifyRequest) (TeamVerifyResult, error) {
	if len(req.Attackers) != SquadSize || len(req.Roster) != SquadSize {
		return TeamVerifyResult{}, fmt.Errorf("a team battle has %d pets a side, got %d and %d", SquadSize, len(req.Attackers), len(req.Roster))
	}
	attackers, attackerPets := fighters(req.Attackers)
	defenders, defenderPets := fighters(req.Roster)

	battle, err := SimulateTeam(attackers, defenders, req.Seed, req.SkillConfig, req.TeamConfig)
	if err != nil {
		return TeamVerifyResult{}, err
	}
	return TeamVerifyResult{
		Battle:      battle,
		Progression: ComputeTeamProgression(attackerPets, defenderPets, battle.AttackerWins, req.MaxLevel),
	}, nil
}

// fighters turns one side's pets into neutral fighters and the inputs progression needs.
func fighters(pets []TeamPet) ([]TeamFighter, []PetInputs) {
	out := make([]TeamFighter, len(pets))
	inputs := make([]PetInputs, len(pets))
	for i, p := range pets {
		out[i] = neutralFighter(p)
		inputs[i] = p.Pet
	}
	return out, inputs
}

func neutralFighter(p TeamPet) TeamFighter {
	return TeamFighter{
		DNA: p.Pet.DNA, Rarity: p.Pet.Rarity, Level: p.Pet.Level, Skill: p.Pet.Skill, Bonus: p.Pet.Bonus,
		Col: p.Col, Row: p.Row, Tactic: p.Tactic, Range: RangeMelee, Temperament: TemperamentNone,
	}
}

// ComputeTeamProgression is what a team battle does to its six fighters, mirroring
// protocol's computeTeamProgression: each fighter takes its team's result and earns XP as
// if it had duelled the highest-level enemy fighter (the lower slot on a tie), under the
// duel's formula and same-opponent decay. Returned attackers first, then defenders.
func ComputeTeamProgression(attackers, defenders []PetInputs, attackerWon bool, maxLevel uint16) []PetProgression {
	award := func(self PetInputs, enemies []PetInputs, won bool) PetProgression {
		base := uint32(BaseXPLoss)
		if won {
			base = BaseXPWin
		}
		return progressionFor(self, strongest(enemies), won, base, maxLevel)
	}
	out := make([]PetProgression, 0, len(attackers)+len(defenders))
	for _, p := range attackers {
		out = append(out, award(p, defenders, attackerWon))
	}
	for _, p := range defenders {
		out = append(out, award(p, attackers, !attackerWon))
	}
	return out
}

// strongest returns the highest-level pet, keeping the earlier one on a tie.
func strongest(pets []PetInputs) PetInputs {
	best := pets[0]
	for _, p := range pets[1:] {
		if p.Level > best.Level {
			best = p
		}
	}
	return best
}
