const express = require('express');
const cookieParser = require('cookie-parser');
const mysql = require('mysql2');
const path = require('path');

const app = express();

// --- 網站名稱設定 ---
const SITE_NAME = "BuildLink";

// --- 資料庫連線設定 (請替換為您的密碼) ---
const dbConfig = {
    host: 'buildlink_db',      // <-- 必須使用服務名稱！
    user: 'buildlinkApp',
    password: 'buildlinkPassword', 
    database: 'BuildLinkApp'   
};
const connection = mysql.createConnection(dbConfig);
connection.connect(err => {
    if (err) {
        console.error('資料庫連線失敗: ' + err.stack);
        return;
    }
    console.log('成功連線到 MySQL 資料庫，連線 ID: ' + connection.threadId);
});

// --- 中介軟體 (Middleware) 設定 ---
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hjs');
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// --- 核心函式: 檢查登入狀態 (Middleware) ---
function checkLogin(req, res, next) {
    if (req.cookies.user_id) {
        next();
    } else {
        res.redirect('/login');
    }
}

// --- 路由定義 ---

// GET /login: 顯示登入頁面
app.get('/login', (req, res) => {
    res.render('login', { title: `${SITE_NAME} 員工登入` });
});

// POST /login: 處理登入表單提交
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.render('login', { error: '請輸入員工編號與密碼。' });
    }

    const sql = 'SELECT * FROM employees WHERE emp_id = ? AND emp_password = ?';
    connection.query(sql, [username, password], (err, results) => {
        if (err) {
            console.error('資料庫查詢錯誤:', err);
            return res.render('login', { error: '系統錯誤，請聯繫管理員。' });
        }
        
        if (results.length > 0) {
            const employee = results[0];
            
            res.cookie('user_id', employee.emp_id, { maxAge: 3600000, httpOnly: true }); 
            
            res.redirect('/');
        } else {
            res.render('login', { error: '員工編號或密碼錯誤。' });
        }
    });
});

// GET /logout: 登出功能
app.get('/logout', (req, res) => {
    res.clearCookie('user_id');
    res.redirect('/login');
});


// GET /: 首頁 (需要登入才能訪問)
app.get('/', checkLogin, (req, res) => {
    const empId = req.cookies.user_id;

    const sql = 'SELECT emp_name FROM employees WHERE emp_id = ?';
    connection.query(sql, [empId], (err, results) => {
        if (err || results.length === 0) {
            console.error('查詢員工姓名失敗或找不到員工:', err);
            res.clearCookie('user_id');
            return res.redirect('/login');
        }
        
        res.render('index', { 
            title: `${SITE_NAME} - 首頁`, 
            username: empId, 
            name: results[0].emp_name
        });
    });
});


// --- 啟動伺服器 ---
const PORT = 80;
app.listen(PORT, () => {
    console.log(`BuildLink 網站運行中，監聽埠號 ${PORT}`);
    console.log(`請在瀏覽器中開啟: http://localhost:8081/`);
});

module.exports = app;