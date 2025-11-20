// 這是一個範本，組員下載後請將此檔案改名為 config.js 並填入自己的資料庫密碼

const config = {
    db: {
        host: 'localhost',      // 組員的電腦通常是 localhost，除非你們共用雲端資料庫
        user: 'root',           // 預設帳號
        password: 'YOUR_PASSWORD_HERE', // ★★★ 請組員填入自己的密碼 ★★★
        database: 'assignment_db',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    },
    // 如果有 HTTPS 設定，也可以保留結構但留空路徑
    use_https: false,
    port: 80
};

module.exports = config;