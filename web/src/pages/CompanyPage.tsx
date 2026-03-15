import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card,
  Row,
  Col,
  Typography,
  Tag,
  Button,
  Table,
  Space,
  Spin,
  Empty,
  Descriptions,
} from 'antd';
import { ArrowLeftOutlined, LinkOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useCompanies, useJobs, useSnapshots } from '../hooks/useData.ts';
import { JOB_CATEGORY_LABELS, THERAPEUTIC_AREA_LABELS } from '../types/index.ts';
import type { Job } from '../types/index.ts';

const { Title, Text } = Typography;

export default function CompanyPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: companies, loading: compLoading } = useCompanies();
  const { data: jobs, loading: jobsLoading } = useJobs();
  const { data: snapshots, loading: snapLoading } = useSnapshots();

  const loading = compLoading || jobsLoading || snapLoading;

  const company = useMemo(
    () => companies.find((c) => c.id === id) ?? null,
    [companies, id]
  );

  // その会社の求人一覧
  const companyJobs = useMemo(
    () => jobs.filter((j) => j.company_id === id),
    [jobs, id]
  );

  // その会社のスナップショット（過去30日）
  const companyTrend = useMemo(() => {
    const today = new Date();
    const dates = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      return d.toISOString().slice(0, 10);
    }).reverse();

    const byDate = Object.fromEntries(
      snapshots
        .filter((s) => s.company_id === id)
        .map((s) => [s.scan_date, s.total_jobs])
    );

    return dates.map((date) => ({
      date: date.slice(5),
      求人数: byDate[date] ?? null,
    }));
  }, [snapshots, id]);

  const hasSnapshotData = companyTrend.some((d) => d['求人数'] !== null);

  const columns: ColumnsType<Job> = [
    {
      title: '求人タイトル',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
    },
    {
      title: '職種カテゴリ',
      dataIndex: 'job_category',
      key: 'job_category',
      width: 130,
      render: (v: string | null) =>
        v ? <Tag>{JOB_CATEGORY_LABELS[v] ?? v}</Tag> : <Text type="secondary">-</Text>,
    },
    {
      title: '疾患領域',
      dataIndex: 'therapeutic_area',
      key: 'therapeutic_area',
      width: 130,
      render: (v: string | null) =>
        v ? (
          <Tag color="purple">{THERAPEUTIC_AREA_LABELS[v] ?? v}</Tag>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '勤務地',
      dataIndex: 'location',
      key: 'location',
      width: 100,
      render: (v: string | null) => v ?? <Text type="secondary">-</Text>,
    },
    {
      title: '初掲載日',
      dataIndex: 'first_seen',
      key: 'first_seen',
      width: 110,
      sorter: (a, b) => a.first_seen.localeCompare(b.first_seen),
      defaultSortOrder: 'descend',
    },
    {
      title: '',
      key: 'action',
      width: 90,
      render: (_, record) =>
        record.url ? (
          <a href={record.url} target="_blank" rel="noopener noreferrer">
            応募ページ →
          </a>
        ) : null,
    },
  ];

  return (
    <div>
      <Button
        icon={<ArrowLeftOutlined />}
        type="text"
        onClick={() => navigate(-1)}
        style={{ marginBottom: 16 }}
      >
        戻る
      </Button>

      {loading && (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" tip="データを読み込み中..." />
        </div>
      )}

      {!loading && !company && (
        <Empty description={`会社 ID "${id}" が見つかりませんでした`} />
      )}

      {!loading && company && (
        <>
          {/* 会社情報ヘッダー */}
          <Card style={{ marginBottom: 24 }}>
            <Row justify="space-between" align="top">
              <Col>
                <Space align="baseline">
                  <Title level={3} style={{ margin: 0 }}>
                    {company.name_ja}
                  </Title>
                  <Tag color={company.category === 'foreign' ? 'orange' : 'green'}>
                    {company.category === 'foreign' ? '外資系' : '内資系'}
                  </Tag>
                </Space>
                <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                  {company.name_en}
                </Text>
              </Col>
              <Col>
                <Button
                  type="primary"
                  icon={<LinkOutlined />}
                  href={`https://${company.careers_url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  採用サイトを見る
                </Button>
              </Col>
            </Row>
            <Descriptions style={{ marginTop: 16 }} size="small" column={3}>
              <Descriptions.Item label="現在の求人数">
                <Text strong>{company.active_jobs} 件</Text>
              </Descriptions.Item>
              <Descriptions.Item label="スクレイパー">{company.scraper}</Descriptions.Item>
              <Descriptions.Item label="追跡状態">
                {company.active ? (
                  <Tag color="green">追跡中</Tag>
                ) : (
                  <Tag>停止中</Tag>
                )}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {/* 求人数推移グラフ */}
          <Card title="求人数推移（過去30日）" style={{ marginBottom: 24 }}>
            {!hasSnapshotData ? (
              <Empty
                description="スナップショットデータがありません（数日スクレイプを続けると表示されます）"
              />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart
                  data={companyTrend}
                  margin={{ top: 8, right: 24, left: 0, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={4} />
                  <YAxis allowDecimals={false} />
                  <Tooltip formatter={(v: unknown) => (v === null || v === undefined ? '-' : `${v} 件`)} />
                  <Line
                    type="monotone"
                    dataKey="求人数"
                    stroke="#1677ff"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* 求人一覧 */}
          <Card
            title={
              <Space>
                <span>求人一覧</span>
                <Tag>{companyJobs.length} 件</Tag>
              </Space>
            }
          >
            {companyJobs.length === 0 ? (
              <Empty description="現在 active な求人はありません" />
            ) : (
              <Table
                columns={columns}
                dataSource={companyJobs}
                rowKey="id"
                size="small"
                pagination={{
                  pageSize: 20,
                  showTotal: (total) => `全 ${total} 件`,
                }}
                scroll={{ x: 800 }}
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
