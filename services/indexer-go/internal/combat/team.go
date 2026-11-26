package combat

import (
	"errors"
	"fmt"
	"slices"
)

// The three-on-three team engine, implemented from docs/battle-protocol.md §F ("Team
// battles") rather than from protocol/src/combat/team.ts, so the two disagree if either
// drifts from that text. contracts/test-vectors/team.json holds them together, and a
// change here is a change to the specification and the TypeScript port as well.
//
// With one fighter a side, the int turn order and no temperament, this is Simulate strike
// for strike; team_golden_test.go replays battle.json and equipment.json to prove it.

// Tactic is how a fighter picks its target.
type Tactic uint8

const (
	TacticFocus Tactic = iota
	TacticBreaker
	TacticHunter
	TacticBodyguard
)

// Range is how far a fighter's physical strike reaches. Magic reaches every enemy.
type Range uint8

const (
	RangeMelee Range = iota
	RangeReach
	RangeRanged
)

// Temperament earns a damage bonus when it suits the fighter's tactic.
type Temperament uint8

const (
	TemperamentNone Temperament = iota
	TemperamentBrave
	TemperamentClever
	TemperamentWild
	TemperamentSteady
	TemperamentLoyal
)

// TurnOrder selects today's initiative (INT, Shell last) or the Attributes 2.0 order.
type TurnOrder uint8

const (
	TurnOrderInt TurnOrder = iota
	TurnOrderSpeed
)

// MaxTeamSize is the most fighters a side can field.
const MaxTeamSize = 3

// TeamFighter is one fighter's inputs. Col counts within the fighter's own zone: 0 back,
// 1 mid, 2 front. Speed is read only under TurnOrderSpeed.
type TeamFighter struct {
	DNA         uint64
	Rarity      uint8
	Level       uint16
	Skill       uint8
	Bonus       AttrBonus
	Col         uint8
	Row         uint8
	Tactic      Tactic
	Range       Range
	Temperament Temperament
	Speed       uint16
}

// TeamConfig holds the team rules' tunable values, which the ruleset publishes.
type TeamConfig struct {
	TurnOrder      TurnOrder
	ComboStepPct   uint16
	ExposePct      uint16
	AuraPct        uint16
	TailwindBps    uint16
	LongShotPct    uint16
	TemperamentPct uint16
}

// DefaultTeamConfig is the launch configuration.
func DefaultTeamConfig() TeamConfig {
	return TeamConfig{
		TurnOrder:      TurnOrderInt,
		ComboStepPct:   10,
		ExposePct:      120,
		AuraPct:        110,
		TailwindBps:    200,
		LongShotPct:    85,
		TemperamentPct: 105,
	}
}

// TeamStrike is one resolved strike. Target and Victim are slots on the side opposite
// Side; they differ only when a Tank guarded. Healed is a slot on Side, or -1.
type TeamStrike struct {
	Round         uint8
	Side          uint8
	Actor         uint8
	Target        uint8
	Victim        uint8
	IsMagic       bool
	Crit          bool
	Damage        uint64
	ElementMult   uint64
	Combo         uint8
	LongShot      bool
	FuryTriggered bool
	Temperament   bool
	Exposed       bool
	Guarded       bool
	SecondChance  bool
	KnockedOut    bool
	Heal          uint64
	Healed        int8
	VictimHPAfter uint32
}

// TeamResult is a finished team battle. StartHP and FinalHP are indexed by side, then slot.
type TeamResult struct {
	AttackerWins      bool
	Rounds            uint8
	WinnerHpRemaining uint16
	StartHP           [2][]uint32
	FinalHP           [2][]uint32
	Log               []TeamStrike
}

type teamUnit struct {
	side, slot        uint8
	f                 TeamFighter
	st                Attrs
	x, row            int
	hp, startHP       uint32
	lastHitBy         *teamUnit
	guarded           bool
	secondChanceSpent bool
	rallied           bool
	mark              *teamUnit
}

// SimulateTeam runs a team battle between the attackers (side 0) and the defenders (side 1).
func SimulateTeam(attackers, defenders []TeamFighter, seed [32]byte, sc SkillConfig, tc TeamConfig) (TeamResult, error) {
	if err := validateTeam(attackers, "attackers"); err != nil {
		return TeamResult{}, err
	}
	if err := validateTeam(defenders, "defenders"); err != nil {
		return TeamResult{}, err
	}

	units := make([]*teamUnit, 0, len(attackers)+len(defenders))
	for i, f := range attackers {
		units = append(units, newTeamUnit(f, 0, uint8(i), sc))
	}
	for i, f := range defenders {
		units = append(units, newTeamUnit(f, 1, uint8(i), sc))
	}

	alive := func(side uint8) bool {
		return slices.ContainsFunc(units, func(u *teamUnit) bool { return u.side == side && u.hp > 0 })
	}
	// Standing neighbours of u, in slot order.
	neighboursOf := func(u *teamUnit) []*teamUnit {
		var out []*teamUnit
		for _, n := range units {
			if n.hp > 0 && neighbours(n, u) {
				out = append(out, n)
			}
		}
		return out
	}

	var log []TeamStrike
	var r uint8
	for r = 0; r < MaxRounds && alive(0) && alive(1); r++ {
		rs := roundSeed(seed, r)

		order := make([]*teamUnit, 0, len(units))
		for _, u := range units {
			if u.hp > 0 {
				order = append(order, u)
			}
		}
		slices.SortStableFunc(order, func(a, b *teamUnit) int { return compareTurnOrder(a, b, tc.TurnOrder) })

		var hits [2][MaxTeamSize]uint8 // this round's hits by each side on each enemy slot

		for p, u := range order {
			if u.hp == 0 {
				continue // knocked out earlier this round; the others keep their positions
			}
			enemy := 1 - u.side
			if !alive(enemy) {
				break
			}

			// 1. Physical or magic.
			pMagic := 10000 * uint64(u.st.INT) / (uint64(u.st.ATK) + uint64(u.st.INT))
			isMagic := strikeRoll(rs, uint8(2*p)) < pMagic

			// 2. Who it can reach.
			var enemies []*teamUnit
			for _, e := range units {
				if e.side == enemy && e.hp > 0 {
					enemies = append(enemies, e)
				}
			}
			line := enemies[0].x
			for _, e := range enemies[1:] {
				if (u.side == 0 && e.x < line) || (u.side == 1 && e.x > line) {
					line = e.x
				}
			}
			behind := line + 1
			if u.side == 1 {
				behind = line - 1
			}
			reach := enemies
			if !isMagic && u.f.Range != RangeRanged {
				reach = nil
				for _, e := range enemies {
					if e.x == line || (u.f.Range == RangeReach && e.x == behind) {
						reach = append(reach, e)
					}
				}
			}

			// 3. The target.
			var own []*teamUnit
			for _, a := range units {
				if a.side == u.side && a.hp > 0 {
					own = append(own, a)
				}
			}
			t := chooseTarget(u, reach, own)

			// 4. Damage, rounding down at every step.
			def, mdef := uint64(t.st.DEF), uint64(t.st.MDEF)
			for _, n := range neighboursOf(t) {
				switch n.f.Skill {
				case SkillShell:
					def = def * uint64(tc.AuraPct) / 100
				case SkillSage:
					mdef = mdef * uint64(tc.AuraPct) / 100
				}
			}
			var d uint64
			if isMagic {
				d = uint64(u.st.INT) * 100 / (100 + mdef)
			} else {
				d = uint64(u.st.ATK) * 100 / (100 + def)
			}
			if d == 0 {
				d = 1
			}

			elem := elementMod(u.st.Element, t.st.Element)
			if u.f.Skill == SkillSage && isMagic && elem < 100 {
				elem = 100
			}
			d = d * elem / 100

			longShot := !isMagic && u.f.Range == RangeRanged && t.x != line
			if longShot {
				d = d * uint64(tc.LongShotPct) / 100
			}

			lowHP := u.startHP > 0 && share(u) < uint64(sc.FuryHPThreshold)
			fury := u.f.Skill == SkillFury && (lowHP || u.rallied)
			if fury {
				d = d * uint64(sc.FuryDmgMult) / 100
			}

			suits := suitsTactic(u.f.Temperament, u.f.Tactic)
			if suits {
				d = d * uint64(tc.TemperamentPct) / 100
			}

			combo := hits[u.side][t.slot]
			if combo > 0 {
				d = d * (100 + uint64(tc.ComboStepPct)*uint64(combo)) / 100
			}

			exposed := t.mark != nil && t.mark.side == u.side && t.mark != u
			if exposed {
				d = d * uint64(tc.ExposePct) / 100
				t.mark = nil
			}

			critBase := uint64(500)
			if u.f.Skill == SkillSwift {
				critBase += uint64(sc.SwiftCritBonus)
			}
			for _, n := range neighboursOf(u) {
				if n.f.Skill == SkillSwift {
					critBase += uint64(tc.TailwindBps)
				}
			}
			critCap := uint64(3000)
			if u.f.Skill == SkillCunning {
				critCap = uint64(sc.CunningCritCap)
			}
			crit := strikeRoll(rs, uint8(2*p+1)) < min(critBase+25*uint64(u.st.INT), critCap)
			if crit {
				d = d * 150 / 100
			}
			if d == 0 {
				d = 1
			}

			// 5. Bookkeeping.
			hits[u.side][t.slot]++
			if crit && u.f.Skill == SkillCunning {
				t.mark = u
			}

			// 6. Guard.
			v := t
			guarded := false
			if uint64(t.hp) <= d {
				for _, g := range units {
					if g != t && g.side == t.side && g.hp > 0 && g.f.Skill == SkillTank && !g.guarded && neighbours(g, t) {
						g.guarded = true
						v = g
						guarded = true
						break
					}
				}
			}

			// 7. The hit lands.
			if uint64(v.hp) > d {
				v.hp -= uint32(d)
			} else {
				v.hp = 0
			}
			v.lastHitBy = u

			// 8. Lifelink.
			var heal uint64
			healed := int8(-1)
			if u.f.Skill == SkillBloodlust && !isMagic {
				heal = d * uint64(sc.BloodlustBps) / 10000
				if heal > 0 {
					h := lowestShare(append([]*teamUnit{u}, neighboursOf(u)...))
					h.hp = uint32(min(uint64(h.hp)+heal, uint64(h.startHP)))
					healed = int8(h.slot)
				}
			}

			// 9. Second chance.
			secondChance := false
			if v.hp == 0 {
				for _, x := range units {
					if x.side == v.side && x.f.Skill == SkillRebirth && !x.secondChanceSpent {
						x.secondChanceSpent = true
						v.hp = 1
						secondChance = true
						break
					}
				}
			}

			// 10. Knockout, which rallies the victim side's Fury fighters.
			knockedOut := v.hp == 0
			if knockedOut {
				for _, x := range units {
					if x.side == v.side && x.f.Skill == SkillFury {
						x.rallied = true
					}
				}
			}

			log = append(log, TeamStrike{
				Round: r, Side: u.side, Actor: u.slot, Target: t.slot, Victim: v.slot,
				IsMagic: isMagic, Crit: crit, Damage: d, ElementMult: elem, Combo: combo,
				LongShot: longShot, FuryTriggered: fury, Temperament: suits, Exposed: exposed,
				Guarded: guarded, SecondChance: secondChance, KnockedOut: knockedOut,
				Heal: heal, Healed: healed, VictimHPAfter: v.hp,
			})
		}
	}

	var attackerWins bool
	switch {
	case alive(0) && !alive(1):
		attackerWins = true
	case alive(1) && !alive(0):
		attackerWins = false
	default:
		attackerWins = sideShare(units, 0) > sideShare(units, 1) // an exact tie goes to the defender
	}

	result := TeamResult{AttackerWins: attackerWins, Rounds: r, Log: log}
	winner := uint8(1)
	if attackerWins {
		winner = 0
	}
	var winnerHP uint64
	for _, u := range units {
		result.StartHP[u.side] = append(result.StartHP[u.side], u.startHP)
		result.FinalHP[u.side] = append(result.FinalHP[u.side], u.hp)
		if u.side == winner {
			winnerHP += uint64(u.hp)
		}
	}
	result.WinnerHpRemaining = uint16(min(winnerHP, 0xFFFF))
	return result, nil
}

// newTeamUnit computes a fighter's stats exactly as a duel does: extract, then gear, then
// the Tank, Shell and Sage multipliers.
func newTeamUnit(f TeamFighter, side, slot uint8, sc SkillConfig) *teamUnit {
	st := Extract(f.DNA, f.Rarity, f.Level)
	applyBonus(&st, f.Bonus)
	switch f.Skill {
	case SkillTank:
		st.HP = uint16(uint32(st.HP) * uint32(sc.TankHPMult) / 100)
	case SkillShell:
		st.DEF = uint16(uint32(st.DEF) * uint32(sc.ShellDefMult) / 100)
	case SkillSage:
		st.MDEF = uint16(uint32(st.MDEF) * uint32(sc.SageMdefMult) / 100)
	}
	x := int(f.Col)
	if side == 1 {
		x = 5 - int(f.Col)
	}
	return &teamUnit{side: side, slot: slot, f: f, st: st, x: x, row: int(f.Row), hp: uint32(st.HP), startHP: uint32(st.HP)}
}

// compareTurnOrder sorts the fighter who acts first to the front.
func compareTurnOrder(a, b *teamUnit, order TurnOrder) int {
	if order == TurnOrderSpeed && a.f.Speed != b.f.Speed {
		return int(b.f.Speed) - int(a.f.Speed)
	}
	if aShell, bShell := a.f.Skill == SkillShell, b.f.Skill == SkillShell; aShell != bShell {
		if aShell {
			return 1
		}
		return -1
	}
	if a.st.INT != b.st.INT {
		return int(b.st.INT) - int(a.st.INT)
	}
	if aSwift, bSwift := a.f.Skill == SkillSwift, b.f.Skill == SkillSwift; aSwift != bSwift {
		if aSwift {
			return -1
		}
		return 1
	}
	if a.side != b.side {
		return int(a.side) - int(b.side)
	}
	return int(a.slot) - int(b.slot)
}

func chooseTarget(u *teamUnit, reach, own []*teamUnit) *teamUnit {
	switch u.f.Tactic {
	case TacticBreaker:
		best := reach[0]
		for _, e := range reach[1:] {
			if e.st.INT > best.st.INT {
				best = e
			}
		}
		return best
	case TacticHunter:
		var prey []*teamUnit
		for _, e := range reach {
			if elementMod(u.st.Element, e.st.Element) == 115 {
				prey = append(prey, e)
			}
		}
		if len(prey) > 0 {
			return lowestShare(prey)
		}
		return lowestShare(reach)
	case TacticBodyguard:
		if hitter := lowestShare(own).lastHitBy; hitter != nil && slices.Contains(reach, hitter) {
			return hitter
		}
		return lowestShare(reach)
	default:
		return lowestShare(reach)
	}
}

// lowestShare keeps the earlier fighter on a tie.
func lowestShare(list []*teamUnit) *teamUnit {
	best := list[0]
	for _, u := range list[1:] {
		if share(u) < share(best) {
			best = u
		}
	}
	return best
}

func share(u *teamUnit) uint64 {
	return uint64(u.hp) * 10000 / uint64(u.startHP)
}

func neighbours(a, b *teamUnit) bool {
	if a == b || a.side != b.side {
		return false
	}
	dx, dr := a.x-b.x, a.row-b.row
	return max(dx, -dx)+max(dr, -dr) == 1
}

func sideShare(units []*teamUnit, side uint8) uint64 {
	var hp, start uint64
	for _, u := range units {
		if u.side == side {
			hp += uint64(u.hp)
			start += uint64(u.startHP)
		}
	}
	return hp * 10000 / start
}

func suitsTactic(t Temperament, tactic Tactic) bool {
	switch t {
	case TemperamentBrave:
		return tactic == TacticFocus
	case TemperamentClever:
		return tactic == TacticBreaker
	case TemperamentWild:
		return tactic == TacticHunter
	case TemperamentSteady:
		return tactic == TacticBodyguard
	default:
		return false
	}
}

func validateTeam(team []TeamFighter, label string) error {
	if len(team) < 1 || len(team) > MaxTeamSize {
		return fmt.Errorf("%s: a side has 1 to %d fighters, got %d", label, MaxTeamSize, len(team))
	}
	var tiles [3][3]bool
	for i, f := range team {
		if f.Col > 2 || f.Row > 2 {
			return fmt.Errorf("%s[%d]: col and row must be 0, 1 or 2, got %d, %d", label, i, f.Col, f.Row)
		}
		if tiles[f.Col][f.Row] {
			return fmt.Errorf("%s[%d]: two fighters share tile %d,%d", label, i, f.Col, f.Row)
		}
		tiles[f.Col][f.Row] = true
		if f.Tactic > TacticBodyguard || f.Range > RangeRanged || f.Temperament > TemperamentLoyal {
			return fmt.Errorf("%s[%d]: unknown tactic, range or temperament", label, i)
		}
	}
	return nil
}

// ErrBadRoster reports a defence plan whose ranks are not 1 to 5, each used once.
var ErrBadRoster = errors.New("a roster has five pets ranked 1 to 5, each rank used once")

// RosterSize and SquadSize are the defence plan's roster and the drawn squad.
const (
	RosterSize = 5
	SquadSize  = 3
)

const squadDrawTag = "CRYPTOPETS_SQUAD_DRAW_V1"

// DrawDefenders draws a team battle's defenders from a five-pet roster, weighting roster
// pet i by 6 - ranks[i]. It returns the drawn roster indices in roster order, which is the
// defenders' slot order.
func DrawDefenders(ranks []uint8, seed [32]byte) ([]int, error) {
	if len(ranks) != RosterSize {
		return nil, ErrBadRoster
	}
	var seen [RosterSize + 1]bool
	for _, rank := range ranks {
		if rank < 1 || rank > RosterSize || seen[rank] {
			return nil, ErrBadRoster
		}
		seen[rank] = true
	}

	remaining := []int{0, 1, 2, 3, 4}
	drawn := make([]int, 0, SquadSize)
	for k := 1; k <= SquadSize; k++ {
		var total uint64
		for _, i := range remaining {
			total += uint64(6 - ranks[i])
		}
		preimage := make([]byte, 0, len(squadDrawTag)+33)
		preimage = append(preimage, squadDrawTag...)
		preimage = append(preimage, seed[:]...)
		preimage = append(preimage, byte(k))
		roll := beBytesMod(keccak256(preimage), total)

		var running uint64
		for at, i := range remaining {
			running += uint64(6 - ranks[i])
			if running > roll {
				drawn = append(drawn, i)
				remaining = slices.Delete(remaining, at, at+1)
				break
			}
		}
	}
	slices.Sort(drawn)
	return drawn, nil
}
