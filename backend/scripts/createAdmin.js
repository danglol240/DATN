// Chạy: node scripts/createAdmin.js <username> <password> [role]
// Ví dụ: node scripts/createAdmin.js admin Admin@123 admin

const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const [,, username, password, role = 'admin'] = process.argv;

  if (!username || !password) {
    console.error('Usage: node scripts/createAdmin.js <username> <password> [role=admin|viewer]');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { username },
    update: { password: hash, role },
    create: { username, password: hash, role },
  });

  console.log(`✓ User "${user.username}" (${user.role}) đã được tạo/cập nhật.`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
