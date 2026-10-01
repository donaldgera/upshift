import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
// One atomic reservation clock coordinates Codeforces API requests across Workers.
export const apiGate=sqliteTable('api_gate',{name:text('name').primaryKey(),nextAt:integer('next_at').notNull()});
