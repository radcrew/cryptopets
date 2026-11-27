# Frontend 🎨

React 19 + Vite web application with Web3 wallet integration for interacting with smart contracts.

## 🛠️ Tech Stack

- **React 19** - Latest React with modern patterns
- **TypeScript** - Type-safe development
- **Vite** - Next-generation frontend build tool
- **Wagmi** - React Hooks for Ethereum
- **Viem** - Lightweight Ethereum library
- **TanStack Query** - Server state management
- **React Router** - Client-side routing

## 📦 Getting Started

### Prerequisites
- Node.js 20+
- pnpm 9.15.9+

### Installation

```bash
# From root directory
pnpm install

# Start frontend only
pnpm dev:fe
```

### Environment Setup

Copy `env.example` to `.env.local`:

```bash
cp env.example .env.local
```

Configure your environment variables:
- `VITE_API_URL` - Backend API endpoint
- `VITE_CONTRACT_ADDRESS` - Smart contract address (auto-injected during dev)

## 🚀 Development

```bash
# Frontend with backend
pnpm dev

# Frontend with Solana
pnpm fe:sol:local

# Frontend with full Ethereum local setup
pnpm fe:eth:local
```

### Available Scripts

```bash
pnpm dev:fe      # Start dev server
pnpm build       # Build for production
pnpm preview     # Preview production build
pnpm lint        # Run ESLint
pnpm lint:fix    # Fix linting issues
```

## 📁 Project Structure

```
frontend/
├── src/
│   ├── components/     # React components
│   ├── hooks/          # Custom React hooks
│   ├── pages/          # Page components
│   ├── services/       # API and Web3 services
│   ├── types/          # TypeScript types
│   └── App.tsx         # Root component
├── public/             # Static assets
├── index.html
├── vite.config.ts
└── tsconfig.json
```

## 🔗 Web3 Integration

### Wallet Connection
- Uses Wagmi for wallet connection
- Supports MetaMask, WalletConnect, and more
- Automatic network detection

### Contract Interaction
- Contract ABI-based interaction
- Type-safe contract calls
- Real-time state updates via TanStack Query

## 🌐 API Integration

Backend API communication through `services/api.ts`:
- Authentication handling
- Error management
- Request/response interceptors

## 📦 Deployment

Not deployed from this repo: it runs on localhost only. `pnpm build` writes a static site to
`dist/`, which any static host can serve; route every path to `index.html`, since the app uses
client-side routing.

```bash
pnpm build
```

## 🤝 Contributing

See [DEVELOPMENT.md](../DEVELOPMENT.md) for overall project guidelines.

---

For issues or questions, refer to the [main README](../README.md).
