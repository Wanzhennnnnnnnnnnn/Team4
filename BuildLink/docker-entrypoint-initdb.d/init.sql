-- 確保使用正確的資料庫
CREATE DATABASE IF NOT EXISTS BuildLinkApp;
USE BuildLinkApp;

-- 刪除舊的 TABLE，以確保重建時不會報錯 
DROP TABLE IF EXISTS partners;
DROP TABLE IF EXISTS employees;

-- 建立 employees (員工) 表格
CREATE TABLE employees (
    id INT PRIMARY KEY AUTO_INCREMENT,
    emp_id VARCHAR(50) UNIQUE NOT NULL,
    emp_password VARCHAR(255) NOT NULL,
    emp_name VARCHAR(100) NOT NULL
);

-- 建立 partners (承包商/供應商) 表格
CREATE TABLE partners (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    company_name VARCHAR(100) UNIQUE NOT NULL,
    contact_email VARCHAR(100),
    role VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL
);

-- 插入測試資料 (員工登入帳號) - 使用英文名稱避免編碼錯誤
INSERT INTO employees (emp_id, emp_password, emp_name) VALUES ('buildlink', '123456', 'System Admin');

-- 插入測試資料 (夥伴登入帳號) - 使用英文公司名稱避免編碼錯誤
INSERT INTO partners (username, password, company_name, contact_email, role, status) VALUES ('contractor1', 'pass123', 'AlphaConstruction', 'contact@contractor.com', 'Contractor', 'Active');
INSERT INTO partners (username, password, company_name, contact_email, role, status) VALUES ('supplier2', 'pass123', 'BetaMaterials', 'contact@supplier.com', 'Supplier', 'Active');


-- 建立應用程式專用使用者
CREATE USER IF NOT EXISTS 'buildlinkApp'@'%' IDENTIFIED BY 'buildlinkPassword';
GRANT ALL PRIVILEGES ON BuildLinkApp.* TO 'buildlinkApp'@'%';
FLUSH PRIVILEGES;