/**
 * SWEEP + CISD Technical Indicator Engine (JavaScript Port of TV Pine Script)
 */

/**
 * Checks if the candle at candidate index `t - right` is a Pivot High.
 * Confirmed at index `t` (where `t = candidate + right`).
 */
function checkPivotHigh(highs, t, left, right) {
    if (t < left + right) return null;
    
    const candidateIdx = t - right;
    const candidateVal = highs[candidateIdx];
    
    // Preceding left bars: candidate must be >= all of them
    for (let i = candidateIdx - left; i < candidateIdx; i++) {
        if (highs[i] > candidateVal) return null;
    }
    
    // Succeeding right bars: candidate must be > all of them
    for (let i = candidateIdx + 1; i <= candidateIdx + right; i++) {
        if (highs[i] >= candidateVal) return null;
    }
    
    return candidateVal;
}

/**
 * Checks if the candle at candidate index `t - right` is a Pivot Low.
 * Confirmed at index `t` (where `t = candidate + right`).
 */
function checkPivotLow(lows, t, left, right) {
    if (t < left + right) return null;
    
    const candidateIdx = t - right;
    const candidateVal = lows[candidateIdx];
    
    // Preceding left bars: candidate must be <= all of them
    for (let i = candidateIdx - left; i < candidateIdx; i++) {
        if (lows[i] < candidateVal) return null;
    }
    
    // Succeeding right bars: candidate must be < all of them
    for (let i = candidateIdx + 1; i <= candidateIdx + right; i++) {
        if (lows[i] <= candidateVal) return null;
    }
    
    return candidateVal;
}

/**
 * Runs the exact Pine Script indicator state simulation over the historical candles array.
 * 
 * @param {Array} candles - Array of candle objects {open, high, low, close, timestamp}
 * @param {Number} pL - Pivot Left (default: 2)
 * @param {Number} pR - Pivot Right (default: 2)
 * @param {Number} piL - Internal Pivot Left (default: 1)
 * @param {Number} piR - Internal Pivot Right (default: 1)
 * @param {Number} look - CISD Window lookback (default: 5)
 * @returns {Object} - { hitLongArr, hitShortArr } arrays of booleans mapping to candle indices
 */
function runIndicatorSimulation(candles, pL = 2, pR = 2, piL = 1, piR = 1, look = 5) {
    const n = candles.length;
    
    // Extract series arrays
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    
    // Output arrays
    const hitLongArr = new Array(n).fill(false);
    const hitShortArr = new Array(n).fill(false);
    
    // State arrays (persisting across bars like Pine Script 'var')
    const arrayH = [];      // Pivot values
    const arrayH_idx = [];  // Pivot bar indices
    const arrayL = [];
    const arrayL_idx = [];
    
    // Wait states
    let s_wait_short = -1;
    let s_lvl_short = null;
    let s_org_short = -1;
    
    let s_wait_long = -1;
    let s_lvl_long = null;
    let s_org_long = -1;
    
    const startIdx = Math.max(pL + pR, piL + piR) + 1;
    
    for (let t = startIdx; t < n; t++) {
        // 1. Check wait states expiration
        if (s_wait_short !== -1 && (t - s_wait_short) > look) {
            s_wait_short = -1;
            s_lvl_short = null;
            s_org_short = -1;
        }
        if (s_wait_long !== -1 && (t - s_wait_long) > look) {
            s_wait_long = -1;
            s_lvl_long = null;
            s_org_long = -1;
        }
        
        // 2. Detect pivots confirmed on bar t
        const pH = checkPivotHigh(highs, t, pL, pR);
        const pL_val = checkPivotLow(lows, t, pL, pR);
        const pHi = checkPivotHigh(highs, t, piL, piR);
        const pLi = checkPivotLow(lows, t, piL, piR);
        
        if (pH !== null) {
            arrayH.push(pH);
            arrayH_idx.push(t - pR);
        }
        if (pL_val !== null) {
            arrayL.push(pL_val);
            arrayL_idx.push(t - pR);
        }
        if (pHi !== null) {
            arrayH.push(pHi);
            arrayH_idx.push(t - piR);
        }
        if (pLi !== null) {
            arrayL.push(pLi);
            arrayL_idx.push(t - piR);
        }
        
        // Capping pivot arrays at 50 to match Pine Script limit
        if (arrayH.length > 50) {
            arrayH.shift();
            arrayH_idx.shift();
        }
        if (arrayL.length > 50) {
            arrayL.shift();
            arrayL_idx.shift();
        }
        
        // 3. Detect sweeps (Bullish Sweep)
        // Loop backwards from newest to oldest active pivot lows
        for (let idx_l = arrayL.length - 1; idx_l >= 0; idx_l--) {
            const val = arrayL[idx_l];
            const org = arrayL_idx[idx_l];
            
            // If the candle closed below this pivot level, it's invalidated
            if (closes[t] < val) {
                arrayL.splice(idx_l, 1);
                arrayL_idx.splice(idx_l, 1);
                continue;
            }
            
            // Sweep condition: low sweeps pivot, but close stays above/equal
            if (lows[t] < val && closes[t] >= val) {
                s_wait_long = t;
                s_lvl_long = val;
                s_org_long = org;
                arrayL.splice(idx_l, 1);
                arrayL_idx.splice(idx_l, 1);
                break; // Max one sweep registered per bar
            }
        }
        
        // 4. Detect sweeps (Bearish Sweep)
        // Loop backwards from newest to oldest active pivot highs
        for (let idx_h = arrayH.length - 1; idx_h >= 0; idx_h--) {
            const val = arrayH[idx_h];
            const org = arrayH_idx[idx_h];
            
            // If the candle closed above this pivot level, it's invalidated
            if (closes[t] > val) {
                arrayH.splice(idx_h, 1);
                arrayH_idx.splice(idx_h, 1);
                continue;
            }
            
            // Sweep condition: high sweeps pivot, but close stays below/equal
            if (highs[t] > val && closes[t] <= val) {
                s_wait_short = t;
                s_lvl_short = val;
                s_org_short = org;
                arrayH.splice(idx_h, 1);
                arrayH_idx.splice(idx_h, 1);
                break; // Max one sweep registered per bar
            }
        }
        
        // 5. CISD Confirmation Check
        if (s_wait_long !== -1 && t >= s_wait_long) {
            // Close breaks above the high of the previous candle
            if (closes[t] > highs[t - 1]) {
                hitLongArr[t] = true;
                s_wait_long = -1; // Reset wait state
                s_lvl_long = null;
            }
        }
        if (s_wait_short !== -1 && t >= s_wait_short) {
            // Close breaks below the low of the previous candle
            if (closes[t] < lows[t - 1]) {
                hitShortArr[t] = true;
                s_wait_short = -1; // Reset wait state
                s_lvl_short = null;
            }
        }
    }
    
    // Return arrays and the last states (for real-time updates)
    return {
        hitLongArr,
        hitShortArr,
        waitingLong: s_wait_long !== -1,
        waitingLongBarsLeft: s_wait_long !== -1 ? (look - (n - 1 - s_wait_long)) : 0,
        waitingShort: s_wait_short !== -1,
        waitingShortBarsLeft: s_wait_short !== -1 ? (look - (n - 1 - s_wait_short)) : 0
    };
}
