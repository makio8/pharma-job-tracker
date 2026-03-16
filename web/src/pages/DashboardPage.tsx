import { useNavigate } from 'react-router-dom';
import {
  Row,
  Col,
  Card,
  Statistic,
  Typography,
  Badge,
  Alert,
  Space,
  Spin,
} from 'antd';
import {
  FileTextOutlined,
  CalendarOutlined,
  BankOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { useMeta, useJobs } from '../hooks/useData.ts';
import { JOB_CATEGORY_LABELS } from '../types/index.ts';

const { Title, Text, Link } = Typography;

export default function DashboardPage() {
  const navigate = useNavigate();
  const { data: meta, loading: metaLoading } = useMeta();
  const { data: jobs, loading: jobsLoading } = useJobs();

  const loading = metaLoading || jobsLoading;

  // 今週新着の定義: first_seen が過去7日以内
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const oneWeekAgoStr = oneWeekAgo.toISOString().slice(0, 10);

  // 今週の新着合計数
  const newThisWeekTotal = jobs.filter((j) => j.first_seen >= oneWeekAgoStr).length;

  // カテゴリ別に集計（今週新着が多い順）
  const categoryStats = Object.keys(JOB_CATEGORY_LABELS).map((key) => {
    const allJobs = jobs.filter((j) => (j.job_category ?? 'other') === key);
    const newThisWeek = allJobs.filter((j) => j.first_seen >= oneWeekAgoStr);
    return {
      key,
      label: JOB_CATEGORY_LABELS[key],
      total: allJobs.length,
      newThisWeek: newThisWeek.length,
    };
  }).sort((a, b) => b.newThisWeek - a.newThisWeek || b.total - a.total);

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        ダッシュボード
      </Title>

      {loading && (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" tip="データを読み込み中..." />
        </div>
      )}

      {!loading && (
        <>
          {/* === StatCards === */}
          <Row gutter={[16, 16]} style={{ marginBottom: 32 }}>
            <Col xs={24} sm={8}>
              <Card>
                <Statistic
                  title="総求人数（active）"
                  value={meta?.total_active_jobs ?? 0}
                  suffix="件"
                  prefix={<FileTextOutlined />}
                  valueStyle={{ color: '#1677ff' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card>
                <Statistic
                  title="今週の新着"
                  value={newThisWeekTotal}
                  suffix="件"
                  prefix={<CalendarOutlined />}
                  valueStyle={{ color: '#52c41a' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card>
                <Statistic
                  title="追跡企業数"
                  value={meta?.companies_count ?? 0}
                  suffix="社"
                  prefix={<BankOutlined />}
                />
              </Card>
            </Col>
          </Row>

          {/* === 職種別 新着サマリー === */}
          <Title level={5} style={{ marginBottom: 16 }}>
            職種別 新着サマリー（過去7日間）
          </Title>

          <Row gutter={[16, 16]} style={{ marginBottom: 32 }}>
            {categoryStats.map(({ key, label, total, newThisWeek }) => {
              const hasNew = newThisWeek > 0;
              return (
                <Col key={key} xs={24} sm={12} lg={8}>
                  <Card
                    hoverable
                    onClick={() => navigate(`/jobs?category=${key}`)}
                    style={{
                      cursor: 'pointer',
                      opacity: !hasNew && total === 0 ? 0.45 : hasNew ? 1 : 0.7,
                    }}
                    styles={{
                      body: { padding: '16px 20px' },
                    }}
                  >
                    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                      <Space direction="vertical" size={2}>
                        <Space align="center">
                          <Text strong style={{ fontSize: 15 }}>
                            {label}
                          </Text>
                          {hasNew && (
                            <Badge
                              count={`NEW ${newThisWeek}`}
                              style={{ backgroundColor: '#52c41a', fontSize: 11 }}
                            />
                          )}
                        </Space>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          合計 {total} 件
                        </Text>
                      </Space>
                      <ArrowRightOutlined style={{ color: '#bfbfbf' }} />
                    </Space>
                  </Card>
                </Col>
              );
            })}
          </Row>

          {/* === ニュースレター CTA === */}
          <Alert
            type="info"
            showIcon
            message={
              <Space>
                <span>📊 パイプライン分析レポート準備中</span>
                <Link href="#" target="_blank">
                  Substack で最新情報を受け取る →
                </Link>
              </Space>
            }
            description="製薬各社のパイプライン状況と採用トレンドを週次でお届けする予定です。登録して続報をお待ちください。"
          />
        </>
      )}
    </div>
  );
}
