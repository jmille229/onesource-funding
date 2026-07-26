import pg from 'pg';
import argon2 from 'argon2';
import dotenv from 'dotenv';

dotenv.config({ path: '../../.env.local' });

// Seed writes across tenants, so it runs as the admin (BYPASSRLS) role, same as
// migrations — not the RLS-scoped app role.
const pool = new pg.Pool({
  connectionString:
    process.env['MIGRATION_DATABASE_URL'] ??
    process.env['DATABASE_URL'] ??
    'postgresql://constructpm:constructpm_dev@localhost:5432/constructpm_dev',
});

const ARGON2_OPTS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

const COMPANY_ID    = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const USER_ADMIN    = 'b2c3d4e5-f6a7-8901-bcde-f01234567891';
const USER_PM       = 'c3d4e5f6-a7b8-9012-cdef-012345678902';
const USER_FIELD    = 'd4e5f6a7-b8c9-0123-defa-0123456789a3';
const JOB_1         = 'e5f6a7b8-c9d0-1234-efab-0123456789b4';
const JOB_2         = 'f6a7b8c9-d0e1-2345-fabc-0123456789c5';
const CONTACT_CUST1 = 'a7b8c9d0-e1f2-3456-abcd-0123456789d6';
const CONTACT_CUST2 = 'b8c9d0e1-f2a3-4567-bcde-0123456789e7';
const CONTACT_VEN1  = 'c9d0e1f2-a3b4-5678-cdef-0123456789f8';

async function seed() {
  // SECURITY: Generate a real argon2id hash — no bcrypt, no plaintext backdoors
  console.log('  Hashing demo password (this takes a moment)...');
  const DEMO_HASH = await argon2.hash('demo1234', ARGON2_OPTS);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🌱 Seeding ConstructPM demo data...\n');

    await client.query(`DELETE FROM companies WHERE id = $1`, [COMPANY_ID]);

    await client.query(`
      INSERT INTO companies (id, name, slug, address_line1, city, state_code, zip, phone,
        subscription_tier, subscription_status, settings)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
    `, [
      COMPANY_ID, 'Hartwell Construction Group', 'hartwell',
      '1200 Commerce Blvd', 'Nashville', 'TN', '37201', '(615) 555-0100',
      'gc_suite', 'active',
      JSON.stringify({
        timezone: 'America/Chicago', date_format: 'MM/DD/YYYY', currency: 'USD',
        default_markup_pct: 18, default_retainage_pct: 10,
        fiscal_year_start_month: 1, invoice_prefix: 'INV-',
        po_prefix: 'PO-', co_prefix: 'CO-', pay_app_prefix: 'PA-',
      }),
    ]);
    console.log('  ✓ Company: Hartwell Construction Group');

    await client.query(`
      INSERT INTO users (id, company_id, email, password_hash, first_name, last_name, role, job_title)
      VALUES
        ($1,$2,'admin@hartwell.com',$3,'Sarah','Hartwell','owner','Owner / President'),
        ($4,$2,'pm@hartwell.com',   $3,'Marcus','Torres','project_manager','Senior Project Manager'),
        ($5,$2,'field@hartwell.com',$3,'Jake','Williams','field_crew','Foreman')
    `, [USER_ADMIN, COMPANY_ID, DEMO_HASH, USER_PM, USER_FIELD]);
    console.log('  ✓ Users seeded (all with argon2id hash)');

    await client.query(`
      INSERT INTO contacts (id, company_id, name, type, email, phone, city, state_code)
      VALUES
        ($1,$2,'Metro School District','customer','contracts@metroschools.gov','(615) 555-0200','Nashville','TN'),
        ($3,$2,'Pinnacle Office Group','customer','pm@pinnacleoffice.com','(615) 555-0300','Brentwood','TN'),
        ($4,$2,'Nashville Supply Co.','vendor','orders@nashvillesupply.com','(615) 555-0400','Nashville','TN')
    `, [CONTACT_CUST1, COMPANY_ID, CONTACT_CUST2, CONTACT_VEN1]);
    console.log('  ✓ Contacts seeded');

    await client.query(`
      INSERT INTO jobs (id, company_id, name, job_number, status, contract_type, contract_amount,
        customer_id, project_manager_id, start_date, end_date, address_line1, city, state_code, zip)
      VALUES
        ($1,$2,'Metro Elementary School Renovation','JOB-2024-001','active','lump_sum',2850000,
         $3,$4,'2024-03-01','2024-11-30','4500 Learning Lane','Nashville','TN','37204'),
        ($5,$2,'Pinnacle Office Complex - Phase 1','JOB-2024-002','awarded','gmp',5400000,
         $6,$4,'2024-06-01','2025-04-30','750 Business Park Dr','Brentwood','TN','37027')
    `, [JOB_1, COMPANY_ID, CONTACT_CUST1, USER_PM, JOB_2, CONTACT_CUST2]);
    console.log('  ✓ Jobs seeded');

    await client.query('COMMIT');
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅  Seed complete!\n');
    console.log('   Login:    admin@hartwell.com');
    console.log('   Password: demo1234\n');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
