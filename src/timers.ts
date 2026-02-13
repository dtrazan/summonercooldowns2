/**
 * Stream Deck Timer Fix
 * 
 * This module fixes unreliable JavaScript timers in Stream Deck plugins by delegating
 * timer operations to a Worker Thread where timing is consistent.
 * 
 * Based on: https://github.com/elgatosf/streamdeck-timerfix
 * Adapted for Node.js using worker_threads instead of Web Workers
 */

import { Worker } from "node:worker_threads";

interface TimerCallback {
	callback: (...args: any[]) => void;
	params: any[];
}

interface WorkerMessage {
	type: 'setTimeout' | 'setInterval' | 'clearTimeout' | 'clearInterval';
	id: number;
	delay?: number;
}

interface WorkerResponse {
	id: number;
	type?: 'clearTimer';
}

// Create the Worker code
const workerCode = `
const { parentPort } = require('node:worker_threads');

let timers = {};
let supportedCommands = ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'];

function clearTimerAndRemove(id) {
	if (timers[id]) {
		clearTimeout(timers[id]);
		delete timers[id];
		parentPort.postMessage({ type: 'clearTimer', id: id });
	}
}

parentPort.on('message', (e) => {
	// First see if we have a timer with this id and remove it
	// This automatically fulfills clearTimeout and clearInterval
	if (supportedCommands.includes(e.type) && timers[e.id]) {
		clearTimerAndRemove(e.id);
	}

	if (e.type === 'setTimeout') {
		timers[e.id] = setTimeout(() => {
			parentPort.postMessage({ id: e.id });
			clearTimerAndRemove(e.id); // Cleaning up
		}, Math.max(e.delay || 0));
	} else if (e.type === 'setInterval') {
		timers[e.id] = setInterval(() => {
			parentPort.postMessage({ id: e.id });
		}, Math.max(e.delay || 10));
	}
});
`;

// Create the Worker Thread
const ESDTimerWorker = new Worker(workerCode, { eval: true });

// Worker state
let timerId = 1;
const timers: Record<number, TimerCallback> = {};

// Set up message handler from worker
ESDTimerWorker.on('message', (data: WorkerResponse) => {
	if (timers[data.id]) {
		if (data.type === 'clearTimer') {
			delete timers[data.id];
		} else {
			const timer = timers[data.id];
			if (timer && timer.callback && typeof timer.callback === 'function') {
				timer.callback(...timer.params);
			}
		}
	}
});

// Internal function to set a timer
function _setTimer(
	callback: (...args: any[]) => void,
	delay: number,
	type: 'setTimeout' | 'setInterval',
	params: any[]
): number {
	const id = timerId++;
	timers[id] = { callback, params };
	ESDTimerWorker.postMessage({ type, id, delay } as WorkerMessage);
	return id;
}

// Replacement functions
function _setTimeoutESD(callback: (...args: any[]) => void, delay: number = 0, ...params: any[]): number {
	return _setTimer(callback, delay, 'setTimeout', params);
}

function _setIntervalESD(callback: (...args: any[]) => void, delay: number = 0, ...params: any[]): number {
	return _setTimer(callback, delay, 'setInterval', params);
}

function _clearTimeoutESD(id: number): void {
	ESDTimerWorker.postMessage({ type: 'clearTimeout', id } as WorkerMessage);
	delete timers[id];
}

// Override native timer functions
(globalThis as any).setTimeout = _setTimeoutESD;
(globalThis as any).setInterval = _setIntervalESD;
(globalThis as any).clearTimeout = _clearTimeoutESD;
(globalThis as any).clearInterval = _clearTimeoutESD; // Timeout and interval share the same timer pool

console.log('[Timers] Stream Deck timer fix loaded - all timers will now use Web Worker for reliability');

// Export for potential direct use
export { _setTimeoutESD as setTimeout, _setIntervalESD as setInterval, _clearTimeoutESD as clearTimeout, _clearTimeoutESD as clearInterval };
