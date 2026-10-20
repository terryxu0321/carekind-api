// Password hashing with Node's built-in scrypt (no extra dependency, CORE-11).
// Parameters follow the OWASP Password Storage Cheat Sheet minimum for scrypt: N=2^17, r=8, p=1.
// They are stored with each hash so they can be raised later without breaking old hashes.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const COST = 2 ** 17;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
// scrypt needs 128 * N * r bytes; Node's default 32 MB limit is too small for N=2^17.
const MAX_MEMORY = 256 * 1024 * 1024;
const PREFIX = 'scrypt';

interface ScryptParams {
	cost: number;
	blockSize: number;
	parallelism: number;
}

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(
			password,
			salt,
			KEY_LENGTH,
			{ N: params.cost, r: params.blockSize, p: params.parallelism, maxmem: MAX_MEMORY },
			(error, key) => (error ? reject(error) : resolve(key)),
		);
	});
}

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_BYTES);
	const params = { cost: COST, blockSize: BLOCK_SIZE, parallelism: PARALLELISM };
	const key = await derive(password, salt, params);
	return [PREFIX, COST, BLOCK_SIZE, PARALLELISM, salt.toString('base64'), key.toString('base64')].join(
		'$',
	);
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
	const [prefix, cost, blockSize, parallelism, salt, key] = storedHash.split('$');
	if (prefix !== PREFIX || salt === undefined || key === undefined) {
		return false;
	}
	const expected = Buffer.from(key, 'base64');
	const actual = await derive(password, Buffer.from(salt, 'base64'), {
		cost: Number(cost),
		blockSize: Number(blockSize),
		parallelism: Number(parallelism),
	});
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let decoyHash: Promise<string> | undefined;

// Unknown emails still pay the hashing cost, so response time does not reveal which emails exist.
export async function verifyAgainstDecoy(password: string): Promise<false> {
	decoyHash ??= hashPassword(randomBytes(SALT_BYTES).toString('base64'));
	await verifyPassword(password, await decoyHash);
	return false;
}
