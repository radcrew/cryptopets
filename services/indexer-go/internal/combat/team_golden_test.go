package combat

import (
	"reflect"
	"testing"
)

// contracts/test-vectors/team.json, which protocol/tests/combat/teamVectors.test.ts reads
// too. A failure means this port drifted from docs/battle-protocol.md §F; fix the Go,
// never the vector.
const teamVectorsPath = "../../../../contracts/test-vectors/team.json"

// vectorSkillConfig has the same fields as every vector file's skillConfig, so any of them
// converts to it.
type vectorSkillConfig struct {
	TankHpMult      uint16 `json:"tankHpMult"`
	ShellDefMult    uint16 `json:"shellDefMult"`
	SwiftCritBonus  uint16 `json:"swiftCritBonus"`
	CunningCritCap  uint16 `json:"cunningCritCap"`
	FuryDmgMult     uint16 `json:"furyDmgMult"`
	FuryHpThreshold uint16 `json:"furyHpThreshold"`
	SageMdefMult    uint16 `json:"sageMdefMult"`
	BloodlustBps    uint16 `json:"bloodlustBps"`
}

func (c vectorSkillConfig) toSkillConfig() SkillConfig {
	return SkillConfig{
		TankHPMult: c.TankHpMult, ShellDefMult: c.ShellDefMult, SwiftCritBonus: c.SwiftCritBonus,
		CunningCritCap: c.CunningCritCap, FuryDmgMult: c.FuryDmgMult, FuryHPThreshold: c.FuryHpThreshold,
		SageMdefMult: c.SageMdefMult, BloodlustBps: c.BloodlustBps,
	}
}

type teamFighterJSON struct {
	DNA         string      `json:"dna"`
	Rarity      uint8       `json:"rarity"`
	Level       uint16      `json:"level"`
	Skill       uint8       `json:"skill"`
	Bonus       vectorBonus `json:"bonus"`
	Col         uint8       `json:"col"`
	Row         uint8       `json:"row"`
	Tactic      string      `json:"tactic"`
	Range       string      `json:"range"`
	Temperament string      `json:"temperament"`
	Speed       uint16      `json:"speed"`
}

type teamConfigJSON struct {
	TurnOrder      string `json:"turnOrder"`
	ComboStepPct   uint16 `json:"comboStepPct"`
	ExposePct      uint16 `json:"exposePct"`
	AuraPct        uint16 `json:"auraPct"`
	TailwindBps    uint16 `json:"tailwindBps"`
	LongShotPct    uint16 `json:"longShotPct"`
	TemperamentPct uint16 `json:"temperamentPct"`
}

type teamVectors struct {
	SkillConfig vectorSkillConfig `json:"skillConfig"`
	LogColumns  []string          `json:"logColumns"`
	Cases       []struct {
		Name       string            `json:"name"`
		Seed       string            `json:"seed"`
		TeamConfig teamConfigJSON    `json:"teamConfig"`
		Attackers  []teamFighterJSON `json:"attackers"`
		Defenders  []teamFighterJSON `json:"defenders"`
		Expected   struct {
			AttackerWins      bool       `json:"attackerWins"`
			Rounds            uint8      `json:"rounds"`
			WinnerHpRemaining uint16     `json:"winnerHpRemaining"`
			StartHp           [][]uint32 `json:"startHp"`
			FinalHp           [][]uint32 `json:"finalHp"`
			Log               [][]int64  `json:"log"`
		} `json:"expected"`
	} `json:"cases"`
}

var (
	tactics      = map[string]Tactic{"focus": TacticFocus, "breaker": TacticBreaker, "hunter": TacticHunter, "bodyguard": TacticBodyguard}
	ranges       = map[string]Range{"melee": RangeMelee, "reach": RangeReach, "ranged": RangeRanged}
	temperaments = map[string]Temperament{
		"none": TemperamentNone, "brave": TemperamentBrave, "clever": TemperamentClever,
		"wild": TemperamentWild, "steady": TemperamentSteady, "loyal": TemperamentLoyal,
	}
	turnOrders = map[string]TurnOrder{"int": TurnOrderInt, "speed": TurnOrderSpeed}
)

func lookup[T any](t *testing.T, table map[string]T, key string) T {
	t.Helper()
	v, ok := table[key]
	if !ok {
		t.Fatalf("unknown value %q in team.json", key)
	}
	return v
}

func (f teamFighterJSON) toFighter(t *testing.T) TeamFighter {
	return TeamFighter{
		DNA: parseDNA(t, f.DNA), Rarity: f.Rarity, Level: f.Level, Skill: f.Skill, Bonus: f.Bonus.toAttrBonus(),
		Col: f.Col, Row: f.Row, Tactic: lookup(t, tactics, f.Tactic), Range: lookup(t, ranges, f.Range),
		Temperament: lookup(t, temperaments, f.Temperament), Speed: f.Speed,
	}
}

func (c teamConfigJSON) toTeamConfig(t *testing.T) TeamConfig {
	return TeamConfig{
		TurnOrder: lookup(t, turnOrders, c.TurnOrder), ComboStepPct: c.ComboStepPct, ExposePct: c.ExposePct,
		AuraPct: c.AuraPct, TailwindBps: c.TailwindBps, LongShotPct: c.LongShotPct, TemperamentPct: c.TemperamentPct,
	}
}

func b2i(v bool) int64 {
	if v {
		return 1
	}
	return 0
}

// logRow follows team.json's logColumns.
func logRow(s TeamStrike) []int64 {
	return []int64{
		int64(s.Round), int64(s.Side), int64(s.Actor), int64(s.Target), int64(s.Victim), b2i(s.IsMagic), b2i(s.Crit),
		int64(s.Damage), int64(s.ElementMult), int64(s.Combo), b2i(s.LongShot), b2i(s.FuryTriggered), b2i(s.Temperament),
		b2i(s.Exposed), b2i(s.Guarded), b2i(s.SecondChance), b2i(s.KnockedOut), int64(s.Heal), int64(s.Healed),
		int64(s.VictimHPAfter),
	}
}

func TestSimulateTeamMatchesGoldenVectors(t *testing.T) {
	var v teamVectors
	loadJSON(t, teamVectorsPath, &v)
	if len(v.Cases) == 0 || len(v.LogColumns) != 20 {
		t.Fatalf("team.json: %d cases, %d log columns", len(v.Cases), len(v.LogColumns))
	}
	sc := v.SkillConfig.toSkillConfig()

	for _, c := range v.Cases {
		t.Run(c.Name, func(t *testing.T) {
			attackers := make([]TeamFighter, len(c.Attackers))
			for i, f := range c.Attackers {
				attackers[i] = f.toFighter(t)
			}
			defenders := make([]TeamFighter, len(c.Defenders))
			for i, f := range c.Defenders {
				defenders[i] = f.toFighter(t)
			}
			got, err := SimulateTeam(attackers, defenders, seedBytes(t, c.Seed), sc, c.TeamConfig.toTeamConfig(t))
			if err != nil {
				t.Fatal(err)
			}
			if got.AttackerWins != c.Expected.AttackerWins || got.Rounds != c.Expected.Rounds ||
				got.WinnerHpRemaining != c.Expected.WinnerHpRemaining {
				t.Fatalf("result: got wins=%v rounds=%d hp=%d, want wins=%v rounds=%d hp=%d",
					got.AttackerWins, got.Rounds, got.WinnerHpRemaining,
					c.Expected.AttackerWins, c.Expected.Rounds, c.Expected.WinnerHpRemaining)
			}
			if !reflect.DeepEqual([][]uint32{got.StartHP[0], got.StartHP[1]}, c.Expected.StartHp) ||
				!reflect.DeepEqual([][]uint32{got.FinalHP[0], got.FinalHP[1]}, c.Expected.FinalHp) {
				t.Fatalf("hp: got start %v final %v, want start %v final %v", got.StartHP, got.FinalHP, c.Expected.StartHp, c.Expected.FinalHp)
			}
			if len(got.Log) != len(c.Expected.Log) {
				t.Fatalf("log: got %d strikes, want %d", len(got.Log), len(c.Expected.Log))
			}
			for i, s := range got.Log {
				if row := logRow(s); !reflect.DeepEqual(row, c.Expected.Log[i]) {
					t.Fatalf("strike %d: got %v, want %v (columns %v)", i, row, c.Expected.Log[i], v.LogColumns)
				}
			}
		})
	}
}

// A one-on-one team battle is a duel strike for strike (§F, "Duels are the special case").
// The expected result is each vector's own, so the two engines cannot pass by agreeing on
// something wrong; the strike comparison proves no team rule fired along the way.
func TestOneOnOneTeamBattlesReproduceDuels(t *testing.T) {
	type duel struct {
		name             string
		dna1, dna2       string
		rarity1, rarity2 uint8
		level1, level2   uint16
		skill1, skill2   uint8
		bonus1, bonus2   AttrBonus
		seed             string
		wins             bool
		rounds           uint8
		hp               uint16
	}
	var duels []duel
	var bv battleVectors
	loadJSON(t, battleVectorsPath, &bv)
	for _, c := range bv.Cases {
		duels = append(duels, duel{c.Name, c.DNA1, c.DNA2, c.Rarity1, c.Rarity2, c.Level1, c.Level2, c.Skill1, c.Skill2,
			NoBonus, NoBonus, c.Seed, c.Expected.FirstWins, c.Expected.Rounds, c.Expected.WinnerHpRemaining})
	}
	ev := loadEquipmentVectors(t)
	for _, c := range ev.Cases {
		duels = append(duels, duel{c.Name, c.DNA1, c.DNA2, c.Rarity1, c.Rarity2, c.Level1, c.Level2, c.Skill1, c.Skill2,
			c.Bonus1.toAttrBonus(), c.Bonus2.toAttrBonus(), c.Seed, c.Expected.FirstWins, c.Expected.Rounds, c.Expected.WinnerHpRemaining})
	}
	if vectorSkillConfig(bv.SkillConfig).toSkillConfig() != DefaultSkillConfig() ||
		vectorSkillConfig(ev.SkillConfig).toSkillConfig() != DefaultSkillConfig() {
		t.Fatal("duel fixtures no longer use the default skill config")
	}
	sc := DefaultSkillConfig()

	for _, d := range duels {
		t.Run(d.name, func(t *testing.T) {
			face := func(dna string, rarity uint8, level uint16, skill uint8, bonus AttrBonus) []TeamFighter {
				return []TeamFighter{{DNA: parseDNA(t, dna), Rarity: rarity, Level: level, Skill: skill, Bonus: bonus, Col: 2, Row: 1}}
			}
			seed := seedBytes(t, d.seed)
			got, err := SimulateTeam(face(d.dna1, d.rarity1, d.level1, d.skill1, d.bonus1),
				face(d.dna2, d.rarity2, d.level2, d.skill2, d.bonus2), seed, sc, DefaultTeamConfig())
			if err != nil {
				t.Fatal(err)
			}
			if got.AttackerWins != d.wins || got.Rounds != d.rounds || got.WinnerHpRemaining != d.hp {
				t.Fatalf("got wins=%v rounds=%d hp=%d, want wins=%v rounds=%d hp=%d",
					got.AttackerWins, got.Rounds, got.WinnerHpRemaining, d.wins, d.rounds, d.hp)
			}

			want := SimulateWithLogAndBonus(parseDNA(t, d.dna1), d.rarity1, d.level1, d.skill1,
				parseDNA(t, d.dna2), d.rarity2, d.level2, d.skill2, seed, sc, d.bonus1, d.bonus2)
			if got.StartHP[0][0] != want.StartHp1 || got.StartHP[1][0] != want.StartHp2 {
				t.Fatalf("start hp: got %v, want %d and %d", got.StartHP, want.StartHp1, want.StartHp2)
			}
			if len(got.Log) != len(want.Log) {
				t.Fatalf("got %d strikes, want %d", len(got.Log), len(want.Log))
			}
			for i, s := range got.Log {
				w := want.Log[i]
				if uint32(s.Round) != w.Round || s.Side+1 != w.Attacker || s.IsMagic != w.IsMagic || s.Crit != w.Crit ||
					s.Damage != w.Damage || s.Heal != w.Heal || s.ElementMult != uint64(w.ElementMult) ||
					s.FuryTriggered != w.FuryTriggered || s.SecondChance != w.RebirthTriggered {
					t.Fatalf("strike %d: team %+v, duel %+v", i, s, w)
				}
				if s.Combo != 0 || s.LongShot || s.Temperament || s.Exposed || s.Guarded {
					t.Fatalf("strike %d: a team rule fired in a duel: %+v", i, s)
				}
			}
		})
	}
}

func TestSimulateTeamRejectsBadInput(t *testing.T) {
	one := func(col, row uint8) TeamFighter {
		return TeamFighter{DNA: 1234567890123456, Rarity: 1, Level: 20, Skill: 99, Col: col, Row: row}
	}
	var seed [32]byte
	sc, tc := DefaultSkillConfig(), DefaultTeamConfig()
	bad := map[string][2][]TeamFighter{
		"empty side":     {{}, {one(2, 1)}},
		"four fighters":  {{one(2, 0), one(2, 1), one(2, 2), one(1, 0)}, {one(2, 1)}},
		"shared tile":    {{one(2, 1), one(2, 1)}, {one(2, 1)}},
		"off the zone":   {{one(3, 1)}, {one(2, 1)}},
		"unknown tactic": {{{DNA: 1, Rarity: 1, Level: 1, Col: 2, Row: 1, Tactic: TacticBodyguard + 1}}, {one(2, 1)}},
	}
	for name, sides := range bad {
		if _, err := SimulateTeam(sides[0], sides[1], seed, sc, tc); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
