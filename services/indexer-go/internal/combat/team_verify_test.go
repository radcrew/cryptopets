package combat

import (
	"encoding/hex"
	"encoding/json"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

// The team receipts in contracts/test-vectors/protocol-team.json were produced by the
// TypeScript side: its draw, its engine, and its computeTeamProgression. Recomputing them
// here locks the team progression composition across the two languages, the way
// progression_test.go does for duels.
const protocolTeamVectorsPath = "../../../../contracts/test-vectors/protocol-team.json"

type vectorTeamPet struct {
	Pet struct {
		PetID          string `json:"petId"`
		DNA            string `json:"dna"`
		Rarity         uint8  `json:"rarity"`
		Level          uint16 `json:"level"`
		Skill          uint8  `json:"skill"`
		XP             uint32 `json:"xp"`
		LastOpponentID string `json:"lastOpponentId"`
		Streak         uint32 `json:"streak"`
		Equipment      []struct {
			HP   uint16 `json:"hp"`
			ATK  uint16 `json:"atk"`
			DEF  uint16 `json:"def"`
			INT  uint16 `json:"int"`
			MDEF uint16 `json:"mdef"`
		} `json:"equipment"`
	} `json:"pet"`
	Col    uint8  `json:"col"`
	Row    uint8  `json:"row"`
	Tactic string `json:"tactic"`
	Rank   uint8  `json:"rank"`
}

type vectorProgression struct {
	PetID          string `json:"petId"`
	Won            bool   `json:"won"`
	DecayShift     uint32 `json:"decayShift"`
	XPAwarded      uint32 `json:"xpAwarded"`
	LastOpponentID string `json:"lastOpponentId"`
	Streak         uint32 `json:"streak"`
	Level          uint16 `json:"level"`
	XP             uint32 `json:"xp"`
	LeveledUp      bool   `json:"leveledUp"`
}

type protocolTeamVectors struct {
	Rulesets []struct {
		Name   string `json:"name"`
		Bundle string `json:"bundle"`
	} `json:"rulesets"`
	TeamReceipts []struct {
		Receipt struct {
			BattleID string `json:"battleId"`
			Snapshot struct {
				Attackers []vectorTeamPet `json:"attackers"`
				Roster    []vectorTeamPet `json:"roster"`
			} `json:"snapshot"`
			Seed   string `json:"seed"`
			Drawn  []int  `json:"drawn"`
			Result struct {
				AttackerWon       bool   `json:"attackerWon"`
				Rounds            uint8  `json:"rounds"`
				WinnerHpRemaining uint16 `json:"winnerHpRemaining"`
			} `json:"result"`
			Progression []vectorProgression `json:"progression"`
		} `json:"receipt"`
	} `json:"teamReceipts"`
}

type rulesetBundle struct {
	MaxLevel    uint16            `json:"maxLevel"`
	SkillConfig vectorSkillConfig `json:"skillConfig"`
	TeamConfig  teamConfigJSON    `json:"teamConfig"`
}

func (p vectorTeamPet) toTeamPet(t *testing.T) TeamPet {
	t.Helper()
	parse := func(s string) uint64 {
		v, err := strconv.ParseUint(s, 10, 64)
		if err != nil {
			t.Fatalf("bad number %q: %v", s, err)
		}
		return v
	}
	items := make([]AttrBonus, len(p.Pet.Equipment))
	for i, e := range p.Pet.Equipment {
		items[i] = AttrBonus{HP: e.HP, ATK: e.ATK, DEF: e.DEF, INT: e.INT, MDEF: e.MDEF}
	}
	return TeamPet{
		Pet: PetInputs{
			PetID: parse(p.Pet.PetID), DNA: parse(p.Pet.DNA), Rarity: p.Pet.Rarity, Level: p.Pet.Level,
			Skill: p.Pet.Skill, XP: p.Pet.XP, LastOpponentID: parse(p.Pet.LastOpponentID), Streak: p.Pet.Streak,
			Bonus: SumBonuses(items),
		},
		Col: p.Col, Row: p.Row, Tactic: lookup(t, tactics, p.Tactic), Rank: p.Rank,
	}
}

func TestVerifyTeamMatchesProtocolTeamReceipts(t *testing.T) {
	var v protocolTeamVectors
	loadJSON(t, protocolTeamVectorsPath, &v)
	if len(v.TeamReceipts) == 0 {
		t.Fatal("no team receipts in protocol-team.json")
	}
	var bundle rulesetBundle
	for _, r := range v.Rulesets {
		if r.Name == "team-geared" {
			if err := json.Unmarshal([]byte(r.Bundle), &bundle); err != nil {
				t.Fatal(err)
			}
		}
	}
	if bundle.MaxLevel == 0 {
		t.Fatal("the team-geared ruleset is missing")
	}

	for _, c := range v.TeamReceipts {
		r := c.Receipt
		t.Run(r.BattleID, func(t *testing.T) {
			seedBytes, err := hex.DecodeString(strings.TrimPrefix(r.Seed, "0x"))
			if err != nil || len(seedBytes) != 32 {
				t.Fatalf("bad seed %q", r.Seed)
			}
			req := TeamVerifyRequest{SkillConfig: bundle.SkillConfig.toSkillConfig(), TeamConfig: bundle.TeamConfig.toTeamConfig(t), MaxLevel: bundle.MaxLevel}
			copy(req.Seed[:], seedBytes)
			for _, p := range r.Snapshot.Attackers {
				req.Attackers = append(req.Attackers, p.toTeamPet(t))
			}
			for _, p := range r.Snapshot.Roster {
				req.Roster = append(req.Roster, p.toTeamPet(t))
			}

			got, err := VerifyTeam(req)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got.Drawn, r.Drawn) {
				t.Fatalf("drawn: got %v, want %v", got.Drawn, r.Drawn)
			}
			if got.Battle.AttackerWins != r.Result.AttackerWon || got.Battle.Rounds != r.Result.Rounds ||
				got.Battle.WinnerHpRemaining != r.Result.WinnerHpRemaining {
				t.Fatalf("result: got %v/%d/%d, want %+v", got.Battle.AttackerWins, got.Battle.Rounds, got.Battle.WinnerHpRemaining, r.Result)
			}
			if len(got.Progression) != len(r.Progression) {
				t.Fatalf("progression: got %d fighters, want %d", len(got.Progression), len(r.Progression))
			}
			for i, p := range got.Progression {
				want := r.Progression[i]
				gotRow := vectorProgression{
					PetID: strconv.FormatUint(p.PetID, 10), Won: p.Won, DecayShift: p.DecayShift, XPAwarded: p.XPAwarded,
					LastOpponentID: strconv.FormatUint(p.LastOpponentID, 10), Streak: p.Streak, Level: p.Level, XP: p.XP, LeveledUp: p.LeveledUp,
				}
				if gotRow != want {
					t.Errorf("fighter %d: got %+v, want %+v", i, gotRow, want)
				}
			}
		})
	}
}
