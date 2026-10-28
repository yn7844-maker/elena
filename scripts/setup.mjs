import {setup,close} from '../lib/db.mjs';
try { await setup(); console.log('데이터베이스 준비 완료'); } finally { await close(); }
