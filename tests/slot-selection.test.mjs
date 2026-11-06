import test from 'node:test';
import assert from 'node:assert/strict';
import { contiguousRanges, paintSlots } from '../lib/slot-selection.ts';
test('fragmented selections preserve gaps and exclusive end boundaries',()=>{
 assert.deepEqual(contiguousRanges([45,27,28,32,36,37,38,40,42,45]),[[27,29],[32,33],[36,39],[40,41],[42,43],[45,46]]);
 assert.deepEqual(contiguousRanges([]),[]);
 assert.deepEqual(contiguousRanges([47]),[[47,48]]);
});
test('painting works in both directions without selecting unavailable slots',()=>{
 const allowed=[18,19,22,23];
 assert.deepEqual(paintSlots([],allowed,23,18,true),allowed);
 assert.deepEqual(paintSlots(allowed,allowed,19,22,false),[18,23]);
 assert.deepEqual(paintSlots([18],allowed,22,23,true),[18,22,23]);
});
