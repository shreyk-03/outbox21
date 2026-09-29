import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  it('holds the old value until the delay passes', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 400), {
        initialProps: { value: 'a' },
      });
      expect(result.current).toBe('a');
      rerender({ value: 'ab' });
      expect(result.current).toBe('a');
      act(() => {
        vi.advanceTimersByTime(399);
      });
      expect(result.current).toBe('a');
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current).toBe('ab');
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the timer on rapid changes (no request per keystroke)', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 400), {
        initialProps: { value: 'a' },
      });
      rerender({ value: 'ab' });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      rerender({ value: 'abc' });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(result.current).toBe('a');
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(result.current).toBe('abc');
    } finally {
      vi.useRealTimers();
    }
  });
});
