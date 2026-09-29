import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectionLimit: 10,
  dateStrings: true,
});

export async function one(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows[0];
}

export async function all(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}
