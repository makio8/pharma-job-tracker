import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Table,
  Select,
  Typography,
  Tag,
  Button,
  Card,
  Row,
  Col,
  Drawer,
  Space,
  Divider,
  Alert,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useJobs, useCompanies } from '../hooks/useData.ts';
import { JOB_CATEGORY_LABELS, THERAPEUTIC_AREA_LABELS } from '../types/index.ts';
import type { Job } from '../types/index.ts';

const { Title, Text, Paragraph } = Typography;

export default function JobsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: jobs, loading: jobsLoading } = useJobs();
  const { data: companies, loading: compLoading } = useCompanies();
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const loading = jobsLoading || compLoading;

  // URL パラメータ
  const filterCompany = searchParams.get('company') ?? '';
  const filterCategory = searchParams.get('category') ?? '';
  const filterTA = searchParams.get('ta') ?? '';
  const filterNew = searchParams.get('new') ?? '';

  const companyMap = useMemo(
    () => Object.fromEntries(companies.map((c) => [c.id, c])),
    [companies]
  );

  // フィルタリング
  const filteredJobs = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return jobs.filter((job) => {
      if (filterCompany && job.company_id !== filterCompany) return false;
      if (filterCategory && job.job_category !== filterCategory) return false;
      if (filterTA && job.therapeutic_area !== filterTA) return false;
      if (filterNew === 'today' && job.first_seen !== today) return false;
      return true;
    });
  }, [jobs, filterCompany, filterCategory, filterTA, filterNew]);

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setSearchParams(next);
  };

  // Select オプション
  const companyOptions = companies.map((c) => ({
    value: c.id,
    label: `${c.name_ja}（${c.active_jobs}件）`,
  }));

  const categoryOptions = Object.entries(JOB_CATEGORY_LABELS).map(([k, v]) => ({
    value: k,
    label: v,
  }));

  const taOptions = Object.entries(THERAPEUTIC_AREA_LABELS).map(([k, v]) => ({
    value: k,
    label: v,
  }));

  const columns: ColumnsType<Job> = [
    {
      title: '会社名',
      key: 'company',
      width: 140,
      render: (_, record) => {
        const company = companyMap[record.company_id];
        return (
          <Button
            type="link"
            size="small"
            style={{ padding: 0 }}
            onClick={() => navigate(`/companies/${record.company_id}`)}
          >
            {company?.name_ja ?? record.company_id}
          </Button>
        );
      },
    },
    {
      title: '求人タイトル',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (title: string, record: Job) => (
        <Button
          type="link"
          onClick={() => setSelectedJob(record)}
          style={{ textAlign: 'left', whiteSpace: 'normal', height: 'auto', padding: 0 }}
        >
          {title}
        </Button>
      ),
    },
    {
      title: '職種カテゴリ',
      dataIndex: 'job_category',
      key: 'job_category',
      width: 120,
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

  const drawerCompany = selectedJob ? companyMap[selectedJob.company_id] : null;

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>
        求人一覧
        <Text type="secondary" style={{ fontSize: 14, fontWeight: 'normal', marginLeft: 12 }}>
          {filteredJobs.length.toLocaleString()} 件
        </Text>
      </Title>

      {/* FilterBar */}
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[12, 12]} align="middle">
          <Col>
            <Text type="secondary" style={{ marginRight: 8 }}>
              絞り込み:
            </Text>
          </Col>
          <Col>
            <Select
              placeholder="会社を選択"
              allowClear
              style={{ width: 200 }}
              value={filterCompany || undefined}
              options={companyOptions}
              onChange={(v) => updateFilter('company', v ?? '')}
              showSearch
              optionFilterProp="label"
            />
          </Col>
          <Col>
            <Select
              placeholder="職種カテゴリ"
              allowClear
              style={{ width: 160 }}
              value={filterCategory || undefined}
              options={categoryOptions}
              onChange={(v) => updateFilter('category', v ?? '')}
            />
          </Col>
          <Col>
            <Select
              placeholder="疾患領域"
              allowClear
              style={{ width: 160 }}
              value={filterTA || undefined}
              options={taOptions}
              onChange={(v) => updateFilter('ta', v ?? '')}
            />
          </Col>
          {filterNew === 'today' && (
            <Col>
              <Tag
                color="green"
                closable
                onClose={() => updateFilter('new', '')}
              >
                今日の新着のみ
              </Tag>
            </Col>
          )}
          {(filterCompany || filterCategory || filterTA || filterNew) && (
            <Col>
              <Button size="small" onClick={() => setSearchParams({})}>
                リセット
              </Button>
            </Col>
          )}
        </Row>
      </Card>

      <Table
        columns={columns}
        dataSource={filteredJobs}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{
          pageSize: 50,
          showSizeChanger: true,
          pageSizeOptions: ['20', '50', '100'],
          showTotal: (total) => `全 ${total.toLocaleString()} 件`,
        }}
        scroll={{ x: 900 }}
      />

      {/* === 求人詳細 Drawer === */}
      <Drawer
        open={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        width={640}
        title={selectedJob?.title}
      >
        {selectedJob ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {/* 会社名 */}
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>会社名</Text>
              <div>
                <Button
                  type="link"
                  style={{ padding: 0, height: 'auto' }}
                  onClick={() => {
                    navigate(`/companies/${selectedJob.company_id}`);
                    setSelectedJob(null);
                  }}
                >
                  {drawerCompany?.name_ja ?? selectedJob.company_id}
                </Button>
              </div>
            </div>

            {/* 職種カテゴリ・疾患領域 */}
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>職種カテゴリ / 疾患領域</Text>
              <div style={{ marginTop: 4 }}>
                <Space wrap>
                  {selectedJob.job_category ? (
                    <Tag>{JOB_CATEGORY_LABELS[selectedJob.job_category] ?? selectedJob.job_category}</Tag>
                  ) : (
                    <Text type="secondary">-</Text>
                  )}
                  {selectedJob.therapeutic_area ? (
                    <Tag color="purple">
                      {THERAPEUTIC_AREA_LABELS[selectedJob.therapeutic_area] ?? selectedJob.therapeutic_area}
                    </Tag>
                  ) : null}
                </Space>
              </div>
            </div>

            {/* 勤務地・部門 */}
            <div>
              <Row gutter={16}>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 12 }}>勤務地</Text>
                  <div>
                    <Text>{selectedJob.location ?? '情報なし'}</Text>
                  </div>
                </Col>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 12 }}>部門</Text>
                  <div>
                    <Text>{selectedJob.department ?? '情報なし'}</Text>
                  </div>
                </Col>
              </Row>
            </div>

            {/* 掲載開始日 */}
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>掲載開始日</Text>
              <div>
                <Text>{selectedJob.first_seen}</Text>
              </div>
            </div>

            {/* 応募ページボタン */}
            {selectedJob.url && (
              <Button
                type="primary"
                href={selectedJob.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                応募ページを開く →
              </Button>
            )}

            {/* === 求人ブリーフ（AI分析） === */}
            {selectedJob.analysis_data?.brief ? (() => {
              const brief = selectedJob.analysis_data.brief as {
                summary: string;
                context_signal: string;
                context_reason: string;
                comparison_tags?: string[];
              };
              const signalMap: Record<string, { color: string; icon: string; label: string }> = {
                hot: { color: '#ff4d4f', icon: '🔥', label: 'HOT' },
                growing: { color: '#52c41a', icon: '📈', label: '成長中' },
                stable: { color: '#1677ff', icon: '⚖️', label: '安定' },
                caution: { color: '#faad14', icon: '⚠️', label: '注意' },
              };
              const signal = signalMap[brief.context_signal] || signalMap.stable;
              return (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Text strong>求人ブリーフ</Text>
                    <Tag color={signal.color}>{signal.icon} {signal.label}</Tag>
                  </div>
                  <Alert
                    type="info"
                    showIcon={false}
                    style={{ marginBottom: 8 }}
                    description={
                      <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0, fontSize: 13 }}>
                        {brief.summary}
                      </Paragraph>
                    }
                  />
                  <div style={{ marginBottom: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {signal.icon} {brief.context_reason}
                    </Text>
                  </div>
                  {brief.comparison_tags && brief.comparison_tags.length > 0 && (
                    <Space wrap size={4}>
                      {brief.comparison_tags.map((tag: string) => (
                        <Tag key={tag} style={{ fontSize: 11 }}>{tag}</Tag>
                      ))}
                    </Space>
                  )}
                </div>
              );
            })() : null}

            {/* === タグ分析（v2） === */}
            {selectedJob.analysis_data && !selectedJob.analysis_data.brief ? (() => {
              const a = selectedJob.analysis_data as Record<string, unknown>;
              return (
                <div>
                  <Text strong style={{ fontSize: 13 }}>AI分析</Text>
                  <div style={{ marginTop: 4 }}>
                    <Space wrap size={4}>
                      {a.english_level ? <Tag color="blue">英語: {String(a.english_level)}</Tag> : null}
                      {a.job_level ? <Tag color="cyan">レベル: {String(a.job_level)}</Tag> : null}
                      {a.global_scope ? <Tag color="geekblue">グローバル: {String(a.global_scope)}</Tag> : null}
                      {a.work_style ? <Tag>勤務: {String(a.work_style)}</Tag> : null}
                      {a.management_role ? <Tag color="gold">マネジメントあり</Tag> : null}
                      {a.career_change_friendly ? <Tag color="green">キャリアチェンジ歓迎</Tag> : null}
                    </Space>
                  </div>
                </div>
              );
            })() : null}

            <Divider style={{ margin: '8px 0' }} />

            {/* 募集要項 */}
            <div>
              <Text strong>募集要項</Text>
              <div style={{ marginTop: 8 }}>
                {selectedJob.description ? (
                  <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                    {selectedJob.description}
                  </Paragraph>
                ) : (
                  <Text type="secondary">情報なし</Text>
                )}
              </div>
            </div>

            <Divider style={{ margin: '8px 0' }} />

            {/* 応募要件 */}
            <div>
              <Text strong>応募要件</Text>
              <div style={{ marginTop: 8 }}>
                {selectedJob.requirements ? (
                  <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                    {selectedJob.requirements}
                  </Paragraph>
                ) : (
                  <Text type="secondary">情報なし</Text>
                )}
              </div>
            </div>
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
