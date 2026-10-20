// drizzle-kit only generates SQL migrations from src/db/schema.ts; it never connects to a database.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/db/schema.ts',
	out: './migrations',
});
