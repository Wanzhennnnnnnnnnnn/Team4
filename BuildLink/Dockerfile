FROM node:18
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .

# ★★★ 修改這裡：開放 80 port ★★★
EXPOSE 80

CMD ["node", "app.js"]