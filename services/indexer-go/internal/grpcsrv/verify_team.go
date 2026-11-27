package grpcsrv

import (
	"context"
	"fmt"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/radcrew/do-not-stop/services/indexer-go/internal/combat"
	"github.com/radcrew/do-not-stop/services/indexer-go/pb"
)

// VerifyTeamBattle independently recomputes a team battle (docs/battle-protocol.md §F,
// "Team battles"): the fight and the six fighters' progression. Like VerifyBattle it reads
// no cache and needs no warm-up; every input is in the request.
func (s *Server) VerifyTeamBattle(_ context.Context, req *pb.VerifyTeamBattleRequest) (*pb.VerifyTeamBattleResponse, error) {
	if n := len(req.GetAttackers()); n != combat.SquadSize {
		return nil, status.Errorf(codes.InvalidArgument, "attackers: want %d pets, got %d", combat.SquadSize, n)
	}
	if n := len(req.GetRoster()); n != combat.SquadSize {
		return nil, status.Errorf(codes.InvalidArgument, "roster: want %d pets, got %d", combat.SquadSize, n)
	}

	verifyReq := combat.TeamVerifyRequest{SkillConfig: skillConfigFromProto(req.GetSkillConfig())}
	for i, p := range req.GetAttackers() {
		pet, err := teamPetFromProto(p)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "attackers[%d]: %v", i, err)
		}
		verifyReq.Attackers = append(verifyReq.Attackers, pet)
	}
	for i, p := range req.GetRoster() {
		pet, err := teamPetFromProto(p)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "roster[%d]: %v", i, err)
		}
		verifyReq.Roster = append(verifyReq.Roster, pet)
	}

	seed := req.GetSeed()
	if len(seed) != 32 {
		return nil, status.Errorf(codes.InvalidArgument, "seed must be 32 bytes, got %d", len(seed))
	}
	copy(verifyReq.Seed[:], seed)

	tc, err := teamConfigFromProto(req.GetTeamConfig())
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "team_config: %v", err)
	}
	verifyReq.TeamConfig = tc

	maxLevel := req.GetMaxLevel()
	if maxLevel == 0 || maxLevel > 0xFFFF {
		return nil, status.Errorf(codes.InvalidArgument, "max_level must be 1-65535, got %d", maxLevel)
	}
	verifyReq.MaxLevel = uint16(maxLevel)

	result, err := combat.VerifyTeam(verifyReq)
	if err != nil {
		// Shared tiles and the like: inputs no honest battle produces.
		return nil, status.Errorf(codes.InvalidArgument, "%v", err)
	}
	return teamResultToProto(result), nil
}

var tacticsByName = map[string]combat.Tactic{
	"focus":     combat.TacticFocus,
	"breaker":   combat.TacticBreaker,
	"hunter":    combat.TacticHunter,
	"bodyguard": combat.TacticBodyguard,
}

func teamPetFromProto(p *pb.VerifyTeamPet) (combat.TeamPet, error) {
	if p == nil {
		return combat.TeamPet{}, fmt.Errorf("missing pet")
	}
	pet, err := petInputsFromProto(p.GetPet())
	if err != nil {
		return combat.TeamPet{}, err
	}
	// Range-checked before narrowing, so an out-of-zone tile is refused rather than wrapped
	// onto a tile the caller never chose.
	if p.GetCol() > 2 || p.GetRow() > 2 {
		return combat.TeamPet{}, fmt.Errorf("col and row must be 0-2, got %d, %d", p.GetCol(), p.GetRow())
	}
	tactic, ok := tacticsByName[p.GetTactic()]
	if !ok {
		return combat.TeamPet{}, fmt.Errorf("unknown tactic %q", p.GetTactic())
	}
	return combat.TeamPet{Pet: pet, Col: uint8(p.GetCol()), Row: uint8(p.GetRow()), Tactic: tactic}, nil
}

// teamConfigFromProto defaults an absent config, as skillConfigFromProto does, so a client
// that omits it gets the launch values rather than a zeroed struct that switches off every
// cooperation rule. A config that is present is taken as sent.
func teamConfigFromProto(p *pb.VerifyTeamConfig) (combat.TeamConfig, error) {
	if p == nil {
		return combat.DefaultTeamConfig(), nil
	}
	// Only the int order until Attributes 2.0: the speed order needs speeds this request
	// does not carry.
	if p.GetTurnOrder() != "int" {
		return combat.TeamConfig{}, fmt.Errorf("turn_order must be \"int\", got %q", p.GetTurnOrder())
	}
	values := []uint32{p.GetComboStepPct(), p.GetExposePct(), p.GetAuraPct(), p.GetTailwindBps(), p.GetLongShotPct(), p.GetTemperamentPct()}
	for _, v := range values {
		if v > 0xFFFF {
			return combat.TeamConfig{}, fmt.Errorf("value out of range: %d", v)
		}
	}
	return combat.TeamConfig{
		TurnOrder:      combat.TurnOrderInt,
		ComboStepPct:   uint16(p.GetComboStepPct()),
		ExposePct:      uint16(p.GetExposePct()),
		AuraPct:        uint16(p.GetAuraPct()),
		TailwindBps:    uint16(p.GetTailwindBps()),
		LongShotPct:    uint16(p.GetLongShotPct()),
		TemperamentPct: uint16(p.GetTemperamentPct()),
	}, nil
}

func teamResultToProto(r combat.TeamVerifyResult) *pb.VerifyTeamBattleResponse {
	log := make([]*pb.VerifyTeamStrike, 0, len(r.Battle.Log))
	for _, s := range r.Battle.Log {
		log = append(log, &pb.VerifyTeamStrike{
			Round: uint32(s.Round), Side: uint32(s.Side), Actor: uint32(s.Actor), Target: uint32(s.Target), Victim: uint32(s.Victim),
			IsMagic: s.IsMagic, Crit: s.Crit, Damage: s.Damage, ElementMult: uint32(s.ElementMult), Combo: uint32(s.Combo),
			LongShot: s.LongShot, FuryTriggered: s.FuryTriggered, Temperament: s.Temperament, Exposed: s.Exposed,
			Guarded: s.Guarded, SecondChance: s.SecondChance, KnockedOut: s.KnockedOut,
			Heal: s.Heal, Healed: int32(s.Healed), VictimHpAfter: s.VictimHPAfter,
		})
	}
	progression := make([]*pb.VerifyPetProgression, 0, len(r.Progression))
	for _, p := range r.Progression {
		progression = append(progression, petProgressionToProto(p))
	}
	return &pb.VerifyTeamBattleResponse{
		AttackerWins:      r.Battle.AttackerWins,
		Rounds:            uint32(r.Battle.Rounds),
		WinnerHpRemaining: uint32(r.Battle.WinnerHpRemaining),
		AttackerStartHp:   r.Battle.StartHP[0],
		DefenderStartHp:   r.Battle.StartHP[1],
		Log:               log,
		Progression:       progression,
	}
}
