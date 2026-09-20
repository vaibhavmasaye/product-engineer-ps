import { Database } from './index.ts';

console.log('Running database migrations...');
const db = new Database();
console.log('Migrations completed successfully.');
db.close();
