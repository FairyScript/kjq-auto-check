# kjq-auto-check

库街区 (Kurobbs) 自动签to脚本，基于 [Bun](https://bun.sh/) 开发。

## 功能特点

- **自动签到**：支持鸣潮（或其他库街区关联游戏）的每日自动签到。
- **防止重复**：签到前会检查当日是否已签到。
- **定时运行**：支持通过 `--cron` 参数设置每日定时任务。
- **环境变量支持**：支持从环境变量中读取 Token、UserId 和 RoleId。

## 快速开始

### 前提条件

- 已安装 [Bun](https://bun.sh/) 运行时。

### 1. 配置环境

在项目根目录下创建一个 `.env` 文件（或设置系统环境变量），包含以下内容：

```env
token=你的Token
userId=你的UserId
roleId=你的RoleId
ipAddr=你的IP地址（建议替换为执行环境的IP地址）
```

### 2. 配置请求头(可选)

将库街区的请求头保存到 `headers.txt` 文件中。脚本会从中读取必要的 header 信息（如 `devicename`, `osversion`, `model` 等）。

格式示例：

```text
devicename: ...
osversion: ...
model: ...
```

### 3. 运行脚本

#### 直接运行一次：

```bash
bun index.ts
```

#### 以定时任务运行（每天 8 点左右随机时间）：

```bash
bun index.ts --cron
```

## 技术栈

- [Bun](https://bun.sh/)
- TypeScript

## 免责声明

本工具仅供学习交流使用，请勿用于非法用途。使用本脚本造成的任何后果由使用者本人承担。
