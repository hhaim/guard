package guardsched

import "fmt"

// RNGStateJSON is CPython random.getstate() serialized for checkpoint v2.
type RNGStateJSON struct {
	Version int     `json:"version"`
	State   []int   `json:"state"`
	Gauss   any     `json:"gauss,omitempty"`
}

// GetState returns CPython-compatible (version, state, gauss) for PyRandom.
// state has 624 MT words plus the index i as the last element (625 total).
func (r *PyRandom) GetState() (version int, state []uint32, gauss any) {
	st := make([]uint32, mtN+1)
	copy(st, r.state[:])
	st[mtN] = uint32(r.idx)
	return 3, st, nil
}

// SetState restores MT19937 from CPython getstate() output.
func (r *PyRandom) SetState(version int, state []uint32, _ any) error {
	if version != 3 {
		return fmt.Errorf("unsupported RNG version %d (want 3)", version)
	}
	mt, idx, err := parseCPythonState(state)
	if err != nil {
		return err
	}
	copy(r.state[:], mt)
	r.idx = idx
	return nil
}

func parseCPythonState(state []uint32) (mt []uint32, idx int, err error) {
	switch len(state) {
	case mtN:
		return state, mtN, nil
	case mtN + 1:
		mt = state[:mtN]
		idx = int(state[mtN])
		return mt, idx, nil
	default:
		return nil, 0, fmt.Errorf("RNG state length %d (want %d or %d)", len(state), mtN, mtN+1)
	}
}

// RNGStateFromJSON loads checkpoint rng_state object.
func RNGStateFromJSON(doc RNGStateJSON) (version int, state []uint32, gauss any, err error) {
	if doc.Version != 3 {
		return 0, nil, nil, fmt.Errorf("unsupported RNG version %d", doc.Version)
	}
	st := make([]uint32, len(doc.State))
	for i, v := range doc.State {
		st[i] = uint32(v)
	}
	mt, idx, err := parseCPythonState(st)
	if err != nil {
		return 0, nil, nil, err
	}
	out := make([]uint32, mtN+1)
	copy(out, mt)
	out[mtN] = uint32(idx)
	return doc.Version, out, doc.Gauss, nil
}
