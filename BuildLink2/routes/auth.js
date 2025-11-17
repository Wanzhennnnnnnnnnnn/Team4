const express = require('express');
const router = express.Router();
let connection;

// 確保資料庫連線物件可用的中介軟體 (middleware)
router.use((req, res, next) => {
    // 從 app.js 取得資料庫連線
    connection = req.app.locals.connection;
    next();
});

// GET /register: 顯示註冊頁面 (不變)
router.get('/register', (req, res) => {
    res.render('register', { title: '承包商/供應商註冊' });
});

// POST /register: 處理註冊表單提交
router.post('/register', (req, res) => {
    const { username, password, company_name, contact_email, role } = req.body;

    if (!connection) {
        console.error('資料庫連線不可用！');
        return res.send('系統錯誤，資料庫連線遺失。');
    }
    if (!username || !password || !company_name || !role) {
        return res.send('錯誤：請填寫所有必填欄位。');
    }

    const initialStatus = 'Active';
    const sql = 'INSERT INTO partners (username, password, company_name, contact_email, role, status) VALUES (?, ?, ?, ?, ?, ?)';
    const values = [username, password, company_name, contact_email, role, initialStatus];

    connection.query(sql, values, (err, result) => {
        if (err) {
            console.error('註冊資料庫錯誤:', err);
            if (err.code === 'ER_DUP_ENTRY') {
                return res.send('錯誤：此帳號或公司名稱已存在。');
            }
            return res.send('系統錯誤，註冊失敗。');
        }

        const successMsg = encodeURIComponent('✅ 註冊成功！請使用您的新帳號登入。');
        res.redirect(`/login?status=${successMsg}`);
    });
});

// POST /login: 處理通用登入表單提交 
router.post('/login', (req, res) => {
    const { username, password, role } = req.body;

    if (!connection) {
        // 如果資料庫連線失敗，優雅地報錯
        const errorMsg = encodeURIComponent('系統錯誤：資料庫連線遺失或服務未運行。');
        return res.redirect(`/login?error=${errorMsg}`);
    }
    if (!username || !password || !role) {
        const errorMsg = encodeURIComponent('請輸入帳號、密碼並選擇您的身分。');
        return res.redirect(`/login?error=${errorMsg}`);
    }

    let sql, redirectPath, cookieName, queryParams;

    if (role === '員工') {
        sql = "SELECT * FROM employees WHERE emp_id = ? AND emp_password = ?";
        redirectPath = '/'; 
        cookieName = 'user_id';
        queryParams = [username, password];
    } else if (role === 'Contractor' || role === 'Supplier') { 
        sql = "SELECT * FROM partners WHERE username = ? AND password = ? AND status = 'Active' AND role = ?";
        redirectPath = '/partner/home'; 
        cookieName = 'partner_id';
        queryParams = [username, password, role];
    } else {
        const errorMsg = encodeURIComponent('無效的身分選項。');
        return res.redirect(`/login?error=${errorMsg}`);
    }

    connection.query(sql, queryParams, (err, results) => {
        if (err) {
            console.error('登入查詢錯誤:', err);
            const errorMsg = encodeURIComponent('系統錯誤，請稍後再試。');
            return res.redirect(`/login?error=${errorMsg}`);
        }

        if (results.length > 0) {
            if (role === '員工') {
                res.clearCookie('partner_id'); 
            } else if (role === 'Contractor' || role === 'Supplier') {
                res.clearCookie('user_id'); 
            }

            res.cookie(cookieName, username, { maxAge: 3600000, httpOnly: true });
            res.redirect(redirectPath);
        } else {
            const errorMsg = encodeURIComponent('帳號或密碼錯誤，或帳號尚未啟用。');
            res.redirect(`/login?error=${errorMsg}`);
        }
    });
});

// --- 新增: 忘記密碼功能 (GET 顯示表單) ---
router.get('/forgot-password', (req, res) => {
    const error = req.query.error ? decodeURIComponent(req.query.error) : null;
    const success = req.query.status ? decodeURIComponent(req.query.status) : null;
    res.render('forgotPassword', {
        title: '忘記密碼 / 密碼重設',
        error: error,
        success: success
    });
});

// --- 新增: 忘記密碼功能 (POST 處理重設) ---
router.post('/forgot-password', (req, res) => {
    const { username, role, new_password } = req.body;

    if (!connection) {
        const errorMsg = encodeURIComponent('系統錯誤：資料庫連線遺失。');
        return res.redirect(`/forgot-password?error=${errorMsg}`);
    }
    if (!username || !role || !new_password) {
        const errorMsg = encodeURIComponent('請輸入帳號、新密碼並選擇您的身分。');
        return res.redirect(`/forgot-password?error=${errorMsg}`);
    }

    let sql, idColumn, passwordColumn;
    let table = '';

    if (role === '員工') {
        table = 'employees';
        idColumn = 'emp_id';
        passwordColumn = 'emp_password';
    } else if (role === 'Contractor' || role === 'Supplier') {
        table = 'partners';
        idColumn = 'username';
        passwordColumn = 'password';
    } else {
        const errorMsg = encodeURIComponent('無效的身分選項。');
        return res.redirect(`/forgot-password?error=${errorMsg}`);
    }

    sql = `UPDATE ${table} SET ${passwordColumn} = ? WHERE ${idColumn} = ?`;
    const values = [new_password, username];

    connection.query(sql, values, (err, result) => {
        if (err) {
            console.error('密碼重設資料庫錯誤:', err);
            const errorMsg = encodeURIComponent('系統錯誤，密碼重設失敗。');
            return res.redirect(`/forgot-password?error=${errorMsg}`);
        }

        if (result.affectedRows === 0) {
            const errorMsg = encodeURIComponent('帳號不存在或身分選擇錯誤。');
            return res.redirect(`/forgot-password?error=${errorMsg}`);
        }

        const successMsg = encodeURIComponent('✅ 密碼重設成功！請使用您的新密碼登入。');
        res.redirect(`/login?status=${successMsg}`);
    });
});


module.exports = router;