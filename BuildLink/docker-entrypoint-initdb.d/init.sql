USE BuildLinkApp;

-- 建立 employees 表格
CREATE TABLE employees (
    id INT PRIMARY KEY AUTO_INCREMENT,
    emp_id VARCHAR(50) UNIQUE NOT NULL,
    emp_password VARCHAR(255) NOT NULL,
    emp_name VARCHAR(100) NOT NULL
);

-- 插入測試資料 (登入帳號)
INSERT INTO employees (emp_id, emp_password, emp_name) VALUES ('buildlink', '123456', '網站管理者');

-- 建立應用程式專用使用者 (使用通配符 % 解決 IP 問題)
CREATE USER 'buildlinkApp'@'%' IDENTIFIED BY 'buildlinkPassword';
GRANT ALL PRIVILEGES ON BuildLinkApp.* TO 'buildlinkApp'@'%';
FLUSH PRIVILEGES;