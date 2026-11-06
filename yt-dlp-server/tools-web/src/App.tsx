import { useEffect } from 'react'
import { useEnabledTools } from './lib/config'
import { useRoute } from './lib/router'
import { Admin } from './pages/Admin'
import { Home } from './pages/Home'
import { NotFound } from './pages/NotFound'
import { ToolPage } from './pages/ToolPage'
import { findTool } from './registry'

export function App() {
  const route = useRoute()
  const config = useEnabledTools()

  useEffect(() => {
    const tool = route.name === 'tool' ? findTool(route.id) : undefined
    document.title = route.name === 'admin' ? 'Quản trị · Hey Tools' : tool ? `${tool.name} · Hey Tools` : 'Hey Tools'
  }, [route])

  switch (route.name) {
    case 'home':
      return <Home config={config} />
    case 'admin':
      return <Admin />
    case 'tool':
      return <ToolPage key={route.id} id={route.id} config={config} />
    default:
      return <NotFound />
  }
}
