// Package guardsched implements the guard scheduler reference logic in Go.
// PyRandom matches CPython 3.11 _random.Random (MT19937 + seeding + random + getrandbits).
package guardsched

import "math/bits"

const (
	mtN          = 624
	mtM          = 397
	matrixA      = 0x9908b0df
	upperMask    = 0x80000000
	lowerMask    = 0x7fffffff
	invTwoPow53  = 1.0 / 9007199254740992.0
	twoPow26f    = 67108864.0
)

// PyRandom is a drop-in subset of CPython's random.Random (enough for guardsched).
type PyRandom struct {
	idx   int
	state [mtN]uint32
}

func NewPyRandom(seed int64) *PyRandom {
	r := &PyRandom{}
	r.SeedInt64(seed)
	return r
}

// SeedInt64 mirrors Random(seed) for small integers (same as Python int seeds from CLI).
func (r *PyRandom) SeedInt64(seed int64) {
	n := seed
	if n < 0 {
		n = -n
	}
	var key []uint32
	if n == 0 {
		key = []uint32{0}
	} else {
		u := uint64(n)
		for u > 0 {
			key = append(key, uint32(u&0xffffffff))
			u >>= 32
		}
	}
	r.initByArray(key)
}

func (r *PyRandom) initGenrand(seed uint32) {
	r.state[0] = seed
	for i := 1; i < mtN; i++ {
		r.state[i] = 1812433253*(r.state[i-1]^(r.state[i-1]>>30)) + uint32(i)
	}
	r.idx = mtN
}

func (r *PyRandom) initByArray(initKey []uint32) {
	r.initGenrand(19650218)
	var i, j int = 1, 0
	k := mtN
	if len(initKey) > k {
		k = len(initKey)
	}
	for kk := k; kk > 0; kk-- {
		r.state[i] = (r.state[i] ^ ((r.state[i-1] ^ (r.state[i-1] >> 30)) * 1664525)) + initKey[j] + uint32(j)
		i++
		j++
		if i >= mtN {
			r.state[0] = r.state[mtN-1]
			i = 1
		}
		if j >= len(initKey) {
			j = 0
		}
	}
	for kk := mtN - 1; kk > 0; kk-- {
		r.state[i] = (r.state[i] ^ ((r.state[i-1] ^ (r.state[i-1] >> 30)) * 1566083941)) - uint32(i)
		i++
		if i >= mtN {
			r.state[0] = r.state[mtN-1]
			i = 1
		}
	}
	r.state[0] = 0x80000000
	r.idx = mtN
}

func (r *PyRandom) genrandUint32() uint32 {
	mag01 := [2]uint32{0, matrixA}
	if r.idx >= mtN {
		var kk int
		for kk = 0; kk < mtN-mtM; kk++ {
			y := (r.state[kk] & upperMask) | (r.state[kk+1] & lowerMask)
			r.state[kk] = r.state[kk+mtM] ^ (y >> 1) ^ mag01[y&1]
		}
		for ; kk < mtN-1; kk++ {
			y := (r.state[kk] & upperMask) | (r.state[kk+1] & lowerMask)
			r.state[kk] = r.state[kk+(mtM-mtN)] ^ (y >> 1) ^ mag01[y&1]
		}
		y := (r.state[mtN-1] & upperMask) | (r.state[0] & lowerMask)
		r.state[mtN-1] = r.state[mtM-1] ^ (y >> 1) ^ mag01[y&1]
		r.idx = 0
	}
	y := r.state[r.idx]
	r.idx++
	y ^= y >> 11
	y ^= (y << 7) & 0x9d2c5680
	y ^= (y << 15) & 0xefc60000
	y ^= y >> 18
	return y
}

// Random returns a float64 in [0, 1) matching random.Random.random().
func (r *PyRandom) Random() float64 {
	a := r.genrandUint32() >> 5
	b := r.genrandUint32() >> 6
	return (float64(a)*twoPow26f + float64(b)) * invTwoPow53
}

// GetRandbits returns k random bits (non-negative), matching random.getrandbits for k<=32.
func (r *PyRandom) GetRandbits(k int) uint64 {
	if k <= 0 {
		return 0
	}
	if k > 32 {
		panic("getrandbits: k>32 not supported")
	}
	return uint64(r.genrandUint32() >> (32 - k))
}

func (r *PyRandom) randBelow(n int) int {
	if n <= 0 {
		panic("randBelow n<=0")
	}
	k := bits.Len64(uint64(n))
	x := r.GetRandbits(k)
	for x >= uint64(n) {
		x = r.GetRandbits(k)
	}
	return int(x)
}

// Choice picks one element (Python random.choice).
func Choice[T any](r *PyRandom, seq []T) T {
	if len(seq) == 0 {
		panic("choice empty")
	}
	return seq[r.randBelow(len(seq))]
}
