import { Routes, Route } from 'react-router-dom'
import { ThreadListPage } from './pages/ThreadListPage'
import { ThreadPage } from './pages/ThreadPage'
import { ConsolidationReviewPage } from './pages/ConsolidationReviewPage'
import { SavedOutputPage } from './pages/SavedOutputPage'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<ThreadListPage />} />
      <Route path="/threads/:id" element={<ThreadPage />} />
      <Route path="/saved/:savedId" element={<SavedOutputPage />} />
      <Route
        path="/threads/:id/consolidations/:proposalId"
        element={<ConsolidationReviewPage />}
      />
    </Routes>
  )
}
