import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getJobTransferStatusPriority,
  sortJobTransferGroups,
  getGroupHeaderTheme,
} from './groupHelpers';

test('getJobTransferStatusPriority puts in-transit first and completed second', () => {
  assert.equal(getJobTransferStatusPriority('อยู่ระหว่างการส่ง'), 0);
  assert.equal(getJobTransferStatusPriority('อยู่ระว่างการส่ง'), 0);
  assert.equal(getJobTransferStatusPriority('ส่งสินค้าเรียบร้อยแล้ว'), 1);
  assert.equal(getJobTransferStatusPriority('ไม่ระบุสถานะ'), 2);
});

test('sortJobTransferGroups places อยู่ระหว่างการส่ง above ส่งสินค้าเรียบร้อยแล้ว', () => {
  const input: Array<[string, number[]]> = [
    ['ส่งสินค้าเรียบร้อยแล้ว', [1, 2, 3]],
    ['อยู่ระหว่างการส่ง', [4, 5]],
  ];
  const sorted = sortJobTransferGroups(input);
  assert.equal(sorted[0][0], 'อยู่ระหว่างการส่ง');
  assert.equal(sorted[1][0], 'ส่งสินค้าเรียบร้อยแล้ว');
});

test('sortJobTransferGroups also handles spelling variant อยู่ระว่างการส่ง first', () => {
  const input: Array<[string, number[]]> = [
    ['ไม่ระบุสถานะ', [9]],
    ['ส่งสินค้าเรียบร้อยแล้ว', [1, 2]],
    ['อยู่ระว่างการส่ง', [3]],
  ];
  const sorted = sortJobTransferGroups(input);
  assert.equal(sorted[0][0], 'อยู่ระว่างการส่ง');
  assert.equal(sorted[1][0], 'ส่งสินค้าเรียบร้อยแล้ว');
  assert.equal(sorted[2][0], 'ไม่ระบุสถานะ');
});

test('getGroupHeaderTheme returns distinct vivid themes for in-transit and completed', () => {
  const inTransitTheme = getGroupHeaderTheme('อยู่ระหว่างการส่ง', '606634465');
  const completedTheme = getGroupHeaderTheme('ส่งสินค้าเรียบร้อยแล้ว', '606634465');

  assert.equal(inTransitTheme.iconType, 'in_transit');
  assert.ok(inTransitTheme.rowClassName.includes('amber'));
  assert.equal(completedTheme.iconType, 'completed');
  assert.ok(completedTheme.rowClassName.includes('emerald'));
});
