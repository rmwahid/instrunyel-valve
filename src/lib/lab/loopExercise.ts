/**
 * Loop tuning exercises.
 *
 * These are the tunes a student can drop into a running loop to feel the
 * difference between them. The names describe what the tune does rather than who
 * invented it, because the point is to build intuition about the effect of each
 * term, and a name does that better than a citation.
 */

export interface LoopExercise {
	id: string;
	name: string;
	/** One line on what the student should watch for. */
	note: string;
	gain: number;
	integralSeconds: number;
	derivativeSeconds: number;
}

export const LOOP_PRESETS: readonly LoopExercise[] = [
	{
		id: 'proportional-only',
		name: 'Proportional only',
		note: 'A steady offset remains, and the loop settles quickly. Watch the measurement stop short of the setpoint and stay there.',
		gain: 2,
		integralSeconds: 0,
		derivativeSeconds: 0
	},
	{
		id: 'proportional-integral',
		name: 'Proportional + integral',
		note: 'The offset disappears because the integral keeps trimming. The cost is a slower settle and the possibility of overshoot.',
		gain: 1.5,
		integralSeconds: 8,
		derivativeSeconds: 0
	},
	{
		id: 'aggressive',
		name: 'Aggressive',
		note: 'A high gain with a short integral time. The loop reaches the setpoint quickly and then oscillates around it.',
		gain: 6,
		integralSeconds: 2,
		derivativeSeconds: 0
	},
	{
		id: 'sluggish',
		name: 'Sluggish',
		note: 'A low gain with a long integral time. Stable and slow, which is often the right choice when the process is noisy.',
		gain: 0.5,
		integralSeconds: 30,
		derivativeSeconds: 0
	},
	{
		id: 'pid',
		name: 'Proportional + integral + derivative',
		note: 'The derivative term damps the approach, which reduces overshoot at the cost of responding to measurement noise.',
		gain: 2.5,
		integralSeconds: 8,
		derivativeSeconds: 1.5
	}
];

export function findLoopPreset(id: string): LoopExercise | undefined {
	return LOOP_PRESETS.find((preset) => preset.id === id);
}
