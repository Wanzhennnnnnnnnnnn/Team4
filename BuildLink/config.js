const config = {
    db: {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '417',
        database: process.env.DB_NAME || 'assignment_db',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    },
    use_https: false,
    // ★★★ 修改這裡：預設改為 80 ★★★
    port: process.env.PORT || 80
};
module.exports = config;