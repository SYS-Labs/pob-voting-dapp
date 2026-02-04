import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import ProgressSpinner from './ProgressSpinner.svelte';

describe('ProgressSpinner', () => {
  it('renders with default props', () => {
    const { container } = render(ProgressSpinner);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('width')).toBe('48');
    expect(svg?.getAttribute('height')).toBe('48');
  });

  it('renders with custom size', () => {
    const { container } = render(ProgressSpinner, { props: { size: 32 } });
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('32');
    expect(svg?.getAttribute('height')).toBe('32');
  });

  it('renders two circles (background and progress)', () => {
    const { container } = render(ProgressSpinner);
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(2);
  });

  it('applies custom className', () => {
    const { container } = render(ProgressSpinner, { props: { className: 'custom-class' } });
    const wrapper = container.querySelector('.tx-spinner');
    expect(wrapper?.classList.contains('custom-class')).toBe(true);
  });

  it('applies progress value when provided', () => {
    const { container } = render(ProgressSpinner, { props: { progress: 50 } });
    const progressCircle = container.querySelectorAll('circle')[1];
    // Progress circle should not have the spinning animation class
    expect(progressCircle?.classList.contains('tx-spinner__circle')).toBe(false);
  });

  it('applies spinning animation class when no progress provided', () => {
    const { container } = render(ProgressSpinner);
    const progressCircle = container.querySelectorAll('circle')[1];
    expect(progressCircle?.classList.contains('tx-spinner__circle')).toBe(true);
  });
});
