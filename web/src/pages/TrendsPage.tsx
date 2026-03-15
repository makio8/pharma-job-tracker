import { useMemo } from 'react';
import { Card, Row, Col, Typography, Spin, Empty } from 'antd';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useSnapshots, useCompanies } from '../hooks/useData.ts';

const { Title, Text } = Typography;

export default function TrendsPage() {
  const { data: snapshots, loading: snapLoading } = useSnapshots();
  const { data: companies, loading: compLoading } = useCompanies();

  const loading = snapLoading || compLoading;

  // 外資 / 内資 の company_id セット
  const foreignIds = useMemo(
    () => new Set(companies.filter((c) => c.category === 'foreign').map((c) => c.id)),
    [companies]
  );
  const domesticIds = useMemo(
    () => new Set(companies.filter((c) => c.category === 'domestic').map((c) => c.id)),
    [companies]
  );

  // 過去30日の日付リスト（降順）
  const last30Dates = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      return d.toISOString().slice(0, 10);
    }).reverse();
  }, []);

  // 全社合計 + 外資 / 内資 集計
  const trendData = useMemo(() => {
    // scan_date ごとに集計
    const byDate: Record<string, { total: number; foreign: number; domestic: number }> = {};
    for (const snap of snapshots) {
      if (!byDate[snap.scan_date]) {
        byDate[snap.scan_date] = { total: 0, foreign: 0, domestic: 0 };
      }
      byDate[snap.scan_date].total += snap.total_jobs;
      if (foreignIds.has(snap.company_id)) {
        byDate[snap.scan_date].foreign += snap.total_jobs;
      }
      if (domesticIds.has(snap.company_id)) {
        byDate[snap.scan_date].domestic += snap.total_jobs;
      }
    }

    return last30Dates.map((date) => ({
      date: date.slice(5), // MM-DD 表示
      全社合計: byDate[date]?.total ?? null,
      外資系: byDate[date]?.foreign ?? null,
      内資系: byDate[date]?.domestic ?? null,
    }));
  }, [snapshots, last30Dates, foreignIds, domesticIds]);

  const hasData = trendData.some((d) => d['全社合計'] !== null);

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        トレンド分析
      </Title>

      {loading && (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" tip="データを読み込み中..." />
        </div>
      )}

      {!loading && (
        <Row gutter={[16, 16]}>
          {/* 全社合計の求人数推移 */}
          <Col xs={24}>
            <Card title="全社合計 求人数推移（過去30日）">
              {!hasData ? (
                <Empty description="スナップショットデータがありません" />
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart
                    data={trendData}
                    margin={{ top: 8, right: 24, left: 0, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      interval={4}
                    />
                    <YAxis allowDecimals={false} />
                    <Tooltip
                      formatter={(v: unknown) => (v === null || v === undefined ? '-' : `${v} 件`)}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="全社合計"
                      stroke="#1677ff"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Card>
          </Col>

          {/* 外資 vs 内資 */}
          <Col xs={24}>
            <Card title="外資系 vs 内資系 比較（過去30日）">
              {!hasData ? (
                <Empty description="スナップショットデータがありません" />
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart
                    data={trendData}
                    margin={{ top: 8, right: 24, left: 0, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      interval={4}
                    />
                    <YAxis allowDecimals={false} />
                    <Tooltip
                      formatter={(v: unknown) => (v === null || v === undefined ? '-' : `${v} 件`)}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="外資系"
                      stroke="#fa8c16"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="内資系"
                      stroke="#52c41a"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Card>
          </Col>

          {/* スナップショットが空の場合の案内 */}
          {!hasData && (
            <Col xs={24}>
              <Card>
                <Text type="secondary">
                  トレンドグラフはスクレイパーを数日運用すると表示されます。
                  <br />
                  <code>npm run scrape</code> を毎日実行して daily_snapshots を蓄積してください。
                </Text>
              </Card>
            </Col>
          )}
        </Row>
      )}
    </div>
  );
}
