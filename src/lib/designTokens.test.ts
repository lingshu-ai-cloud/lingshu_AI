import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lsCssVariables, lsDesignTokenCss, lsMotion, lsTypography } from './designTokens';
import { getScrollBehavior, prefersReducedMotion, REDUCED_MOTION_QUERY, subscribeReducedMotion } from './usePrefersReducedMotion';
import { animateMotionValue, JSAnimation, MotionGlobalConfig, motionValue, visualElementStore, type VisualElement } from 'motion/react';
import { createMotionPolicyManager, settleMotionRoot } from './motionPolicy';

test('physical springs preserve the specified damping ratio and expose time in correct units', () => {
  for (const value of Object.values(lsMotion.spring)) {
    assert.ok(Math.abs(value.damping / (2 * Math.sqrt(value.stiffness * value.mass)) - 0.9) < 1e-10);
    assert.equal('duration' in value, false);
  }
  for (const [name, duration] of Object.entries(lsMotion.duration)) {
    assert.equal(lsCssVariables[`--ls-motion-${name}`], `${duration}ms`);
  }
  for (const [name, role] of Object.entries(lsTypography)) {
    assert.ok(role.line >= role.size);
    assert.equal(lsCssVariables[`--ls-type-${name}-size`], `${role.size}px`);
  }
  assert.ok(lsDesignTokenCss.startsWith(':root{'));
});

test('scroll and preference subscriptions respond immediately and clean up listeners', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const listeners = new Set<() => void>();
  let reduced = true;
  const media = {
    get matches() { return reduced; },
    addEventListener: (event: string, listener: () => void) => { assert.equal(event, 'change'); listeners.add(listener); },
    removeEventListener: (event: string, listener: () => void) => { assert.equal(event, 'change'); listeners.delete(listener); },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { matchMedia: (query: string) => { assert.equal(query, REDUCED_MOTION_QUERY); return media; } } });
  try {
    assert.equal(prefersReducedMotion(), true);
    assert.equal(getScrollBehavior(), 'auto');
    const observed: boolean[] = [];
    const unsubscribe = subscribeReducedMotion(() => observed.push(prefersReducedMotion()));
    reduced = false;
    listeners.forEach(listener => listener());
    assert.deepEqual(observed, [false]);
    assert.equal(getScrollBehavior(), 'smooth');
    reduced = true;
    listeners.forEach(listener => listener());
    assert.deepEqual(observed, [false, true]);
    assert.equal(getScrollBehavior(), 'auto');
    unsubscribe();
    assert.equal(listeners.size, 0);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('motion policy supports initial reduced mode, repeated toggles and prior-policy restoration', () => {
  for (const previous of [undefined, false, true]) {
    const config = { skipAnimations: previous };
    const register = createMotionPolicyManager(config);
    let release = register(true);
    assert.equal(config.skipAnimations, true);
    release();
    release = register(false);
    assert.equal(config.skipAnimations, false);
    release();
    release = register(true);
    assert.equal(config.skipAnimations, true);
    release();
    assert.equal(config.skipAnimations, previous);
  }
});

test('one reduced root wins until released without losing another root or the original setting', () => {
  const config = { skipAnimations: true };
  const register = createMotionPolicyManager(config);
  const releaseA = register(false);
  assert.equal(config.skipAnimations, false);
  const releaseB = register(true);
  const releaseC = register(false);
  assert.equal(config.skipAnimations, true);
  releaseA();
  assert.equal(config.skipAnimations, true);
  releaseB();
  assert.equal(config.skipAnimations, false);
  releaseB(); // Strict cleanup remains idempotent.
  assert.equal(config.skipAnimations, false);
  releaseC();
  assert.equal(config.skipAnimations, true);
});

test('the real Motion engine starts animating again after initial reduced mode is disabled', () => {
  const previous = MotionGlobalConfig.skipAnimations;
  const originalElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  const originalSvgElement = Object.getOwnPropertyDescriptor(globalThis, 'SVGElement');
  // Ownerless MotionValues use the JavaScript driver in this Node test.
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: class HTMLElement {} });
  Object.defineProperty(globalThis, 'SVGElement', { configurable: true, value: class SVGElement {} });
  const register = createMotionPolicyManager(MotionGlobalConfig);
  const startFade = () => animateMotionValue('opacity', motionValue<number>(0), 1, { duration: 1 })(() => {});
  let release = register(true);
  try {
    assert.equal(startFade(), undefined, 'initial reduced mode skips an opacity animation');
    release();
    release = register(false);
    const resumed = startFade();
    assert.ok(resumed, 'normal mode creates an animation again');
    assert.equal(resumed.duration, 1);
    resumed.stop();
    release();
    release = register(true);
    assert.equal(startFade(), undefined, 're-enabling reduced mode skips future animations');
  } finally {
    release();
    assert.equal(MotionGlobalConfig.skipAnimations, previous);
    if (originalElement) Object.defineProperty(globalThis, 'HTMLElement', originalElement);
    else Reflect.deleteProperty(globalThis, 'HTMLElement');
    if (originalSvgElement) Object.defineProperty(globalThis, 'SVGElement', originalSvgElement);
    else Reflect.deleteProperty(globalThis, 'SVGElement');
  }
});

test('a running opacity transition and spring settle at their targets without remounting', () => {
  const root = { querySelectorAll: () => [child] } as unknown as HTMLElement;
  const child = {};
  const outsider = {};
  const opacity = motionValue(0);
  const width = motionValue(60);
  const outsideValue = motionValue(0);
  const driver = () => ({ start: () => {}, stop: () => {}, now: () => 0 });
  const fade = new JSAnimation({ keyframes: [0, 1], duration: 1000, driver, onUpdate: value => opacity.set(value) });
  const expand = new JSAnimation({ keyframes: [60, 176], ...lsMotion.spring.standard, driver, onUpdate: value => width.set(value) });
  const outsideAnimation = new JSAnimation({ keyframes: [0, 1], duration: 1000, driver, onUpdate: value => outsideValue.set(value) });
  opacity.animation = fade;
  width.animation = expand;
  outsideValue.animation = outsideAnimation;
  visualElementStore.set(child, { values: new Map([['opacity', opacity], ['width', width]]) } as unknown as VisualElement);
  visualElementStore.set(outsider, { values: new Map([['opacity', outsideValue]]) } as unknown as VisualElement);
  try {
    fade.tick(100);
    expand.tick(30);
    outsideAnimation.tick(100);
    assert.ok(opacity.get() > 0 && opacity.get() < 1);
    assert.notEqual(width.get(), 176);
    assert.equal(settleMotionRoot(root), 2);
    // Motion applies complete() on the next render frame, with no duration wait.
    fade.tick(101);
    expand.tick(31);
    assert.equal(opacity.get(), 1);
    assert.equal(width.get(), 176);
    assert.equal(fade.state, 'finished');
    assert.equal(expand.state, 'finished');
    assert.equal(outsideAnimation.state, 'running');
    assert.ok(outsideValue.get() < 1);
  } finally {
    fade.stop();
    expand.stop();
    outsideAnimation.stop();
    visualElementStore.delete(child);
    visualElementStore.delete(outsider);
  }
});
