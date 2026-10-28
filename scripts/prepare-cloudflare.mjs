import {readFileSync,writeFileSync} from 'node:fs';
const databaseId=process.env.CLOUDFLARE_D1_DATABASE_ID;
if(!databaseId||!/^[-a-zA-Z0-9]+$/.test(databaseId))throw new Error('Set CLOUDFLARE_D1_DATABASE_ID to your D1 database ID.');
const file=new URL('../dist/server/wrangler.json',import.meta.url);
const config=JSON.parse(readFileSync(file,'utf8'));
config.name='opentonton';
config.d1_databases=[{binding:'DB',database_name:'opentonton',database_id:databaseId,migrations_dir:'../../drizzle'}];
config.triggers={crons:['0 * * * *']};
config.observability={enabled:false};
config.workers_dev=true;
// Custom CPU limits require the paid Standard usage model.
// Workers Free applies its own fixed limits; do not opt into paid settings.
delete config.limits;
writeFileSync(file,JSON.stringify(config,null,2)+'\n');
console.log('Standalone Cloudflare configuration prepared. Hourly expiry cleanup enabled.');
