import { useNavigate } from 'react-router-dom';
import {
  Row,
  Col,
  Card,
  Statistic,
  Typography,
  List,
  Tag,
  Button,
  Alert,
  Space,
  Spin,
} from 'antd';
import {
  FileTextOutlined,
  PlusCircleOutlined,
  BankOutlined,
  GlobalOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { useMeta, useCompanies, useJobs, useNewToday } from '../hooks/useData.ts';
import { JOB_CATEGORY_LABELS } from '../types/index.ts';

const { Title, Text, Link } = Typography;

const PIE_COLORS = [
  '#1677ff', '#52c41a', '#fa8c16', '#f5222d', '#722ed1',
  '#13c2c2', '#eb2f96', '#fadb14', '#a0d911', '#2f54eb',
  '#fa541c', '#8c8c8c',
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const { data: meta, loading: metaLoading } = useMeta();
  const { data: companies, loading: compLoading } = useCompanies();
  const { data: jobs, loading: jobsLoading } = useJobs();
  const { data: newToday, loading: newLoading } = useNewToday();

  const loading = metaLoading || compLoading || jobsLoading || newLoading;

  // 外資求人数
  const foreignCompanyIds = new Set(
    companies.filter((c) => c.category === 'foreign').map((c) => c.id)
  );
  const foreignJobsCount = jobs.filter((j) => foreignCompanyIds.has(j.company_id)).length;

  // 会社別求人数 TOP10（棒グラフ用）
  const companyRanking = [...companies]
    .filter((c) => c.active_jobs > 0)
    .sort((a, b) => b.active_jobs - a.active_jobs)
    .slice(0, 10)
    .map((c) => ({
      name: c.name_ja,
      求人数: c.active_jobs,
      category: c.category,
    }));

  // 職種構成（円グラフ用）
  const categoryCount: Record<string, number> = {};
  for (const job of jobs) {
    const key = job.job_category ?? 'other';
    categoryCount[key] = (categoryCount[key] ?? 0) + 1;
  }
  const pieData = Object.entries(categoryCount)
    .map(([key, value]) => ({
      name: JOB_CATEGORY_LABELS[key] ?? key,
      value,
    }))
    .sort((a, b) => b.value - a.value);

  // 会社名マップ
  const companyMap = Object.fromEntries(companies.map((c) => [c.id, c]));

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
          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            <Col xs={24} sm={12} lg={6}>
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
            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="今日の新着"
                  value={meta?.new_today ?? 0}
                  suffix="件"
                  prefix={<PlusCircleOutlined />}
                  valueStyle={{ color: '#52c41a' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="追跡企業数"
                  value={meta?.companies_count ?? 0}
                  suffix="社"
                  prefix={<BankOutlined />}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="外資求人数"
                  value={foreignJobsCount}
                  suffix="件"
                  prefix={<GlobalOutlined />}
                  valueStyle={{ color: '#fa8c16' }}
                />
              </Card>
            </Col>
          </Row>

          {/* === 今日の新着 TOP5 === */}
          <Card
            title={
              <Space>
                <PlusCircleOutlined style={{ color: '#52c41a' }} />
                <span>今日の新着求人</span>
                <Tag color="green">{newToday.length} 件</Tag>
              </Space>
            }
            extra={
              <Button
                type="link"
                icon={<ArrowRightOutlined />}
                onClick={() => navigate('/jobs?new=today')}
              >
                すべて見る
              </Button>
            }
            style={{ marginBottom: 24 }}
          >
            {newToday.length === 0 ? (
              <Text type="secondary">今日の新着はまだありません</Text>
            ) : (
              <List
                dataSource={newToday.slice(0, 5)}
                renderItem={(job) => {
                  const company = companyMap[job.company_id];
                  return (
                    <List.Item
                      actions={[
                        job.url ? (
                          <a href={job.url} target="_blank" rel="noopener noreferrer">
                            応募ページ →
                          </a>
                        ) : null,
                      ].filter(Boolean)}
                    >
                      <List.Item.Meta
                        title={
                          <Space>
                            <Text strong>{job.title}</Text>
                            {job.job_category && (
                              <Tag>{JOB_CATEGORY_LABELS[job.job_category] ?? job.job_category}</Tag>
                            )}
                          </Space>
                        }
                        description={
                          <Space split="·">
                            <Text type="secondary">
                              {company?.name_ja ?? job.company_id}
                            </Text>
                            {job.location && <Text type="secondary">{job.location}</Text>}
                          </Space>
                        }
                      />
                    </List.Item>
                  );
                }}
              />
            )}
          </Card>

          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            {/* === 会社別求人数ランキング === */}
            <Col xs={24} xl={14}>
              <Card title="会社別求人数 TOP10">
                {companyRanking.length === 0 ? (
                  <Text type="secondary">データがありません</Text>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart
                      data={companyRanking}
                      layout="vertical"
                      margin={{ top: 4, right: 32, left: 8, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={100}
                        tick={{ fontSize: 12 }}
                      />
                      <Tooltip formatter={(v: number) => [`${v} 件`, '求人数']} />
                      <Bar
                        dataKey="求人数"
                        fill="#1677ff"
                        radius={[0, 4, 4, 0]}
                        label={{ position: 'right', fontSize: 11 }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </Col>

            {/* === 職種構成 === */}
            <Col xs={24} xl={10}>
              <Card title="職種構成">
                {pieData.length === 0 ? (
                  <Text type="secondary">データがありません</Text>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="45%"
                        outerRadius={100}
                        dataKey="value"
                        label={({ name, percent }: { name: string; percent: number }) =>
                          percent > 0.04 ? `${name} ${(percent * 100).toFixed(0)}%` : ''
                        }
                        labelLine={false}
                      >
                        {pieData.map((_, index) => (
                          <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => [`${v} 件`]} />
                      <Legend
                        wrapperStyle={{ fontSize: 11 }}
                        formatter={(value) => value}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </Col>
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
