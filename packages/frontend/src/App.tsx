import { Routes, Route } from 'react-router-dom'
import { ThreadListPage } from './pages/ThreadListPage'
import { ThreadPage } from './pages/ThreadPage'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<ThreadListPage />} />
      <Route path="/threads/:id" element={<ThreadPage />} />
    </Routes>
  )
}
