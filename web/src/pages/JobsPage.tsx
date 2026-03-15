import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Table, Select, Typography, Tag, Button, Card, Row, Col } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useJobs, useCompanies } from '../hooks/useData.ts';
import { JOB_CATEGORY_LABELS, THERAPEUTIC_AREA_LABELS } from '../types/index.ts';
import type { Job } from '../types/index.ts';

const { Title, Text } = Typography;

export default function JobsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: jobs, loading: jobsLoading } = useJobs();
  const { data: companies, loading: compLoading } = useCompanies();

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
    </div>
  );
}
