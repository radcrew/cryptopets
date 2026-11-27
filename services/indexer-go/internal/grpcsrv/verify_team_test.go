package grpcsrv

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/radcrew/do-not-stop/services/indexer-go/pb"
)

func teamRequest() *pb.VerifyTeamBattleRequest {
	pet := func(id, dna string, level uint32, skill uint32) *pb.VerifyPetInputs {
		return &pb.VerifyPetInputs{PetId: id, Dna: dna, Rarity: 2, Level: level, Skill: skill}
	}
	return &pb.VerifyTeamBattleRequest{
		Attackers: []*pb.VerifyTeamPet{
			{Pet: pet("11", "3412405035806012", 12, 4), Col: 2, Row: 1, Tactic: "focus"},
			{Pet: pet("12", "3412477554741624", 13, 3), Col: 1, Row: 1, Tactic: "breaker"},
			{Pet: pet("13", "3412457044705502", 11, 2), Col: 1, Row: 2, Tactic: "hunter"},
		},
		Roster: []*pb.VerifyTeamPet{
			{Pet: pet("21", "3412757264528005", 14, 5), Col: 1, Row: 1, Tactic: "breaker"},
			{Pet: pet("22", "3412555075457001", 12, 1), Col: 2, Row: 1, Tactic: "hunter"},
			{Pet: pet("23", "3412506055309003", 10, 0), Col: 2, Row: 0, Tactic: "bodyguard"},
		},
		Seed:     make([]byte, 32),
		MaxLevel: 100,
	}
}

func TestVerifyTeamBattleWorksWithNoCache(t *testing.T) {
	client := verifyClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	resp, err := client.VerifyTeamBattle(ctx, teamRequest())
	if err != nil {
		t.Fatalf("VerifyTeamBattle: %v", err)
	}
	if len(resp.GetAttackerStartHp()) != 3 || len(resp.GetDefenderStartHp()) != 3 {
		t.Fatalf("want three start HPs a side, got %v / %v", resp.GetAttackerStartHp(), resp.GetDefenderStartHp())
	}
	if resp.GetRounds() == 0 || len(resp.GetLog()) == 0 {
		t.Error("expected at least one round and a non-empty strike log")
	}
	// Six fighters, attackers then defenders, each by slot.
	ids := []string{"11", "12", "13", "21", "22", "23"}
	got := make([]string, len(resp.GetProgression()))
	for i, p := range resp.GetProgression() {
		got[i] = p.GetPetId()
	}
	if !reflect.DeepEqual(got, ids) {
		t.Errorf("progression pet ids = %v, want %v", got, ids)
	}
}

func TestVerifyTeamBattleDefaultsTeamConfig(t *testing.T) {
	client := verifyClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Absent: the launch values, never a zeroed config that switches off every cooperation rule.
	withDefaults, err := client.VerifyTeamBattle(ctx, teamRequest())
	if err != nil {
		t.Fatal(err)
	}
	explicit := teamRequest()
	explicit.TeamConfig = &pb.VerifyTeamConfig{TurnOrder: "int", ComboStepPct: 10, ExposePct: 120, AuraPct: 110, TailwindBps: 200, LongShotPct: 85, TemperamentPct: 105}
	withExplicit, err := client.VerifyTeamBattle(ctx, explicit)
	if err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(withDefaults, withExplicit) {
		t.Error("an absent team_config must behave exactly like the launch configuration")
	}
}

func TestVerifyTeamBattleRejectsMalformedInput(t *testing.T) {
	client := verifyClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cases := []struct {
		name   string
		modify func(*pb.VerifyTeamBattleRequest)
	}{
		{"two attackers", func(r *pb.VerifyTeamBattleRequest) { r.Attackers = r.Attackers[:2] }},
		{"two defenders", func(r *pb.VerifyTeamBattleRequest) { r.Roster = r.Roster[:2] }},
		{"unknown tactic", func(r *pb.VerifyTeamBattleRequest) { r.Attackers[0].Tactic = "charge" }},
		{"tile off the zone", func(r *pb.VerifyTeamBattleRequest) { r.Attackers[0].Col = 3 }},
		{"two pets on one tile", func(r *pb.VerifyTeamBattleRequest) { r.Attackers[1].Col, r.Attackers[1].Row = 2, 1 }},
		{"short seed", func(r *pb.VerifyTeamBattleRequest) { r.Seed = make([]byte, 16) }},
		{"zero max level", func(r *pb.VerifyTeamBattleRequest) { r.MaxLevel = 0 }},
		{"speed turn order", func(r *pb.VerifyTeamBattleRequest) {
			r.TeamConfig = &pb.VerifyTeamConfig{TurnOrder: "speed", ExposePct: 120, AuraPct: 110, LongShotPct: 85, TemperamentPct: 105}
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := teamRequest()
			c.modify(req)
			_, err := client.VerifyTeamBattle(ctx, req)
			if status.Code(err) != codes.InvalidArgument {
				t.Errorf("code = %v, want InvalidArgument", status.Code(err))
			}
		})
	}
}

// The team receipts in protocol-team.json, through the wire: the layer the combat package's
// own test cannot cover, since a field mis-mapped between protobuf and Go would pass there.
func TestVerifyTeamBattleMatchesProtocolTeamReceiptsOverGRPC(t *testing.T) {
	type vectorPet struct {
		Pet struct {
			PetID          string `json:"petId"`
			DNA            string `json:"dna"`
			Rarity         uint32 `json:"rarity"`
			Level          uint32 `json:"level"`
			Skill          uint32 `json:"skill"`
			XP             uint32 `json:"xp"`
			LastOpponentID string `json:"lastOpponentId"`
			Streak         uint32 `json:"streak"`
			Equipment      []struct {
				HP, ATK, DEF, INT, MDEF uint32
			} `json:"equipment"`
		} `json:"pet"`
		Col, Row uint32
		Tactic   string `json:"tactic"`
	}
	var v struct {
		Rulesets []struct {
			Name   string `json:"name"`
			Bundle string `json:"bundle"`
		} `json:"rulesets"`
		TeamReceipts []struct {
			Receipt struct {
				BattleID string `json:"battleId"`
				Snapshot struct {
					Attackers []vectorPet `json:"attackers"`
					Roster    []vectorPet `json:"roster"`
				} `json:"snapshot"`
				Seed   string `json:"seed"`
				Result struct {
					AttackerWon       bool   `json:"attackerWon"`
					Rounds            uint32 `json:"rounds"`
					WinnerHpRemaining uint32 `json:"winnerHpRemaining"`
				} `json:"result"`
				Progression []struct {
					PetID     string `json:"petId"`
					XPAwarded uint32 `json:"xpAwarded"`
					Level     uint32 `json:"level"`
					XP        uint32 `json:"xp"`
				} `json:"progression"`
			} `json:"receipt"`
		} `json:"teamReceipts"`
	}
	data, err := os.ReadFile(filepath.FromSlash("../../../../contracts/test-vectors/protocol-team.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	// protojson, not encoding/json, for the two configs: the bundle uses the camelCase names,
	// and protojson both reads those and refuses a key the message does not have.
	var bundle struct {
		MaxLevel    uint32
		SkillConfig *pb.VerifySkillConfig
		TeamConfig  *pb.VerifyTeamConfig
	}
	for _, r := range v.Rulesets {
		if r.Name != "team-geared" {
			continue
		}
		var raw struct {
			MaxLevel    uint32          `json:"maxLevel"`
			SkillConfig json.RawMessage `json:"skillConfig"`
			TeamConfig  json.RawMessage `json:"teamConfig"`
		}
		if err := json.Unmarshal([]byte(r.Bundle), &raw); err != nil {
			t.Fatal(err)
		}
		bundle.MaxLevel, bundle.SkillConfig, bundle.TeamConfig = raw.MaxLevel, &pb.VerifySkillConfig{}, &pb.VerifyTeamConfig{}
		if err := protojson.Unmarshal(raw.SkillConfig, bundle.SkillConfig); err != nil {
			t.Fatal(err)
		}
		if err := protojson.Unmarshal(raw.TeamConfig, bundle.TeamConfig); err != nil {
			t.Fatal(err)
		}
	}
	if bundle.MaxLevel == 0 || bundle.TeamConfig == nil || bundle.SkillConfig == nil {
		t.Fatal("the team-geared ruleset is missing or incomplete")
	}

	toProto := func(p vectorPet) *pb.VerifyTeamPet {
		in := &pb.VerifyPetInputs{
			PetId: p.Pet.PetID, Dna: p.Pet.DNA, Rarity: p.Pet.Rarity, Level: p.Pet.Level, Skill: p.Pet.Skill,
			Xp: p.Pet.XP, LastOpponentId: p.Pet.LastOpponentID, Streak: p.Pet.Streak,
		}
		for _, e := range p.Pet.Equipment {
			in.BonusHp += e.HP
			in.BonusAtk += e.ATK
			in.BonusDef += e.DEF
			in.BonusInt += e.INT
			in.BonusMdef += e.MDEF
		}
		return &pb.VerifyTeamPet{Pet: in, Col: p.Col, Row: p.Row, Tactic: p.Tactic}
	}

	client := verifyClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	for _, c := range v.TeamReceipts {
		r := c.Receipt
		t.Run(r.BattleID, func(t *testing.T) {
			seed, err := hex.DecodeString(strings.TrimPrefix(r.Seed, "0x"))
			if err != nil {
				t.Fatal(err)
			}
			req := &pb.VerifyTeamBattleRequest{Seed: seed, SkillConfig: bundle.SkillConfig, TeamConfig: bundle.TeamConfig, MaxLevel: bundle.MaxLevel}
			for _, p := range r.Snapshot.Attackers {
				req.Attackers = append(req.Attackers, toProto(p))
			}
			for _, p := range r.Snapshot.Roster {
				req.Roster = append(req.Roster, toProto(p))
			}
			resp, err := client.VerifyTeamBattle(ctx, req)
			if err != nil {
				t.Fatal(err)
			}
			if resp.GetAttackerWins() != r.Result.AttackerWon || resp.GetRounds() != r.Result.Rounds ||
				resp.GetWinnerHpRemaining() != r.Result.WinnerHpRemaining {
				t.Fatalf("result = %v/%d/%d, want %+v", resp.GetAttackerWins(), resp.GetRounds(), resp.GetWinnerHpRemaining(), r.Result)
			}
			for i, p := range resp.GetProgression() {
				want := r.Progression[i]
				if p.GetPetId() != want.PetID || p.GetXpAwarded() != want.XPAwarded || p.GetLevel() != want.Level || p.GetXp() != want.XP {
					t.Errorf("fighter %d: got %s xp+%d level %d xp %d, want %+v", i, p.GetPetId(), p.GetXpAwarded(), p.GetLevel(), p.GetXp(), want)
				}
			}
		})
	}
}
